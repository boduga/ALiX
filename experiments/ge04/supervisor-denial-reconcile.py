#!/usr/bin/env python3
"""Fail-closed read-only reconciliation of a deny-only GE04 journal record."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat


def load(name):
    spec = importlib.util.spec_from_file_location('ge04_' + name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def reconcile(root: Path, attempt_id: str, owner_uid: int = 0) -> str:
    try:
        recovery = load('supervisor-ledger-reconcile')
        trusted = load('trusted-path')
        if recovery.classify(root, attempt_id, owner_uid) != 'NOT_AUTHORIZED':
            return 'UNCERTAIN'
        fd = trusted.open_trusted_directory(root, owner_uid)
        try:
            def read(name):
                handle = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
                try:
                    before = os.fstat(handle)
                    if (not stat.S_ISREG(before.st_mode) or before.st_uid != owner_uid or
                            before.st_nlink != 1 or before.st_mode & 0o077 or before.st_size > 4096):
                        raise ValueError('untrusted record')
                    data = os.read(handle, 4097)
                    after = os.fstat(handle)
                    if len(data) > 4096 or (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                        raise ValueError('changed record')
                    return data
                finally:
                    os.close(handle)
            original = read(attempt_id + '.json')
            denial = read(attempt_id + '.denied')
        finally:
            os.close(fd)
        def unique(pairs):
            obj = {}
            for key, value in pairs:
                if key in obj:
                    raise ValueError('duplicate key')
                obj[key] = value
            return obj
        record = json.loads(denial, object_pairs_hook=unique)
        if (type(record) is not dict or set(record) != {'version', 'attemptId', 'state', 'reason', 'preSpawnSha256'} or
                type(record['version']) is not int or record['version'] != 1 or
                record['attemptId'] != attempt_id or record['state'] != 'DENIED' or
                not isinstance(record['reason'], str) or not record['reason'] or
                len(record['reason']) > 128 or not record['reason'].isascii() or
                record['preSpawnSha256'] != hashlib.sha256(original).hexdigest()):
            return 'UNCERTAIN'
        return 'DENIED'
    except (OSError, ValueError, TypeError, KeyError):
        return 'UNCERTAIN'
