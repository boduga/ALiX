#!/usr/bin/env python3
"""Experimental deny-only append journal. No admission, execution, or success path."""
import hashlib
import json
import os
from pathlib import Path
import stat


def _encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def append_denial(root: Path, attempt_id: str, reason: str, owner_uid: int = 0):
    """Persist one irreversible DENIED transition for an existing pre-spawn attempt."""
    import importlib.util
    spec = importlib.util.spec_from_file_location('ge04_ledger_reconcile', Path(__file__).with_name('supervisor-ledger-reconcile.py'))
    recovery = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(recovery)
    spec = importlib.util.spec_from_file_location('ge04_trusted_path', Path(__file__).with_name('trusted-path.py'))
    trusted = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(trusted)
    if not isinstance(reason, str) or not reason or len(reason) > 128 or not reason.isascii():
        raise ValueError('invalid denial reason')
    if recovery.classify(root, attempt_id, owner_uid) != 'NOT_AUTHORIZED':
        raise PermissionError('untrusted pre-spawn evidence')
    fd = trusted.open_trusted_directory(root, owner_uid)
    try:
        # O_EXCL prevents competing writers from overwriting the same attempt.
        record = {'version': 1, 'attemptId': attempt_id, 'state': 'DENIED', 'reason': reason,
                  'preSpawnSha256': hashlib.sha256(_read_pre_spawn(fd, attempt_id)).hexdigest()}
        entry = os.open(attempt_id + '.denied', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=fd)
        try:
            data = _encode(record) + b'\n'
            while data:
                count = os.write(entry, data)
                if count <= 0:
                    raise OSError('short journal write')
                data = data[count:]
            os.fsync(entry)
        finally:
            os.close(entry)
        os.fsync(fd)
    finally:
        os.close(fd)


def _read_pre_spawn(fd: int, attempt_id: str) -> bytes:
    entry = os.open(attempt_id + '.json', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
    try:
        before = os.fstat(entry)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_mode & 0o077 or before.st_size > 4096:
            raise PermissionError('invalid pre-spawn inode')
        data = os.read(entry, 4097)
        after = os.fstat(entry)
        if len(data) > 4096 or (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            raise PermissionError('pre-spawn evidence changed')
        return data
    finally:
        os.close(entry)
