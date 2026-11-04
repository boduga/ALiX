#!/usr/bin/env python3
"""GE04 SUP-06 isolated single-use signed claim reservation, NOT admission.

Fixture caller supplies signing pin, expected binding and clock. Neither an
exclusive record nor a matching signature authenticates production authority.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat

def _load():
    spec = importlib.util.spec_from_file_location('ge04_claim_matcher', Path(__file__).with_name('signed-authority-claim.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def _name(nonce: str) -> str:
    return hashlib.sha256(b'GE04-SUP06-NONCE-V1\x00' + nonce.encode('ascii')).hexdigest() + '.claim-reserved'

def _open_root(path: Path, owner_uid: int) -> int:
    # Reuse the existing component-wise trusted-path validator. A caller-chosen
    # root is STILL not a production trust root, regardless of its permissions.
    spec = importlib.util.spec_from_file_location('ge04_trusted_path', Path(__file__).with_name('trusted-path.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    fd = module.open_trusted_directory(path, owner_uid)
    meta = os.fstat(fd)
    if meta.st_mode & 0o077:
        os.close(fd)
        raise PermissionError('reservation root must be owner-only')
    return fd

def reserve_claim(root: Path, message: bytes, signature: bytes, public_key: bytes,
                  pinned_key_sha256: str, expected: dict, now_ms: int,
                  revoked: bool, owner_uid: int = 0,
                  fixture_crash_after_create: bool = False) -> str:
    """Return only TEST_RESERVED_UNTRUSTED, never AUTHORIZED."""
    result = _load().match_signed_claim(message, signature, public_key,
                                        pinned_key_sha256, expected, now_ms, revoked)
    if result != 'TEST_MATCH_UNTRUSTED':
        raise PermissionError('signed claim not matched')
    # Strict already-verified JSON. No other code may call this as authority.
    claim = json.loads(message)
    filename = _name(claim['nonce'])
    fd = _open_root(root, owner_uid)
    try:
        entry = os.open(filename, os.O_WRONLY | os.O_CREAT | os.O_EXCL |
                        os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=fd)
        try:
            if fixture_crash_after_create:
                os._exit(89)  # deterministic crash checkpoint; record is uncertain
            record = json.dumps({
                'version': 1, 'state': 'RESERVED_UNTRUSTED',
                'claimSha256': hashlib.sha256(message).hexdigest(),
                'attemptId': claim['attemptId'], 'admission': 'NOT_AUTHORIZED'
            }, sort_keys=True, separators=(',', ':')).encode() + b'\n'
            remaining = memoryview(record)
            while remaining:
                size = os.write(entry, remaining)
                if size <= 0:
                    raise OSError('short reservation write')
                remaining = remaining[size:]
            os.fsync(entry)
        finally:
            os.close(entry)
        os.fsync(fd)
        return 'TEST_RESERVED_UNTRUSTED'
    finally:
        os.close(fd)

def classify_reservation(root: Path, nonce: str, message: bytes,
                         owner_uid: int = 0) -> str:
    """A valid fixture reservation is still NOT an admission or receipt."""
    try:
        if not isinstance(nonce, str) or not nonce.isascii() or len(nonce) > 128:
            return 'UNCERTAIN'
        fd = _open_root(root, owner_uid)
        try:
            entry = os.open(_name(nonce), os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
            try:
                before = os.fstat(entry)
                if (not stat.S_ISREG(before.st_mode) or before.st_uid != owner_uid or
                        before.st_nlink != 1 or before.st_mode & 0o077 or
                        before.st_size > 4096):
                    return 'UNCERTAIN'
                raw = os.read(entry, 4097)
                after = os.fstat(entry)
                if (len(raw) != before.st_size or
                        (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) !=
                        (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)):
                    return 'UNCERTAIN'
            finally:
                os.close(entry)
        finally:
            os.close(fd)
        def unique(pairs):
            output = {}
            for key, value in pairs:
                if key in output:
                    raise ValueError('duplicate reservation key')
                output[key] = value
            return output
        record = json.loads(raw, object_pairs_hook=unique)
        claim = json.loads(message, object_pairs_hook=unique)
        if (type(claim) is not dict or claim.get('nonce') != nonce or
                type(claim.get('attemptId')) is not str):
            return 'UNCERTAIN'
        if (type(record) is not dict or set(record) !=
                {'version', 'state', 'claimSha256', 'attemptId', 'admission'} or
                record['attemptId'] != claim['attemptId'] or
                type(record['version']) is not int or record['version'] != 1 or
                record['state'] != 'RESERVED_UNTRUSTED' or
                record['admission'] != 'NOT_AUTHORIZED' or
                record['claimSha256'] != hashlib.sha256(message).hexdigest()):
            return 'UNCERTAIN'
        return 'RESERVED_UNTRUSTED'
    except (OSError, ValueError, TypeError, KeyError, PermissionError, UnicodeError):
        return 'UNCERTAIN'
