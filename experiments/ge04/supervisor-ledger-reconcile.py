#!/usr/bin/env python3
"""Fail-closed, read-only classification of experimental pre-spawn records.

No record can authorize execution or establish a terminal success receipt.
"""
import json
import os
from pathlib import Path
import re
import stat

ATTEMPT = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
DIGEST = re.compile(r'^[0-9a-f]{64}$')


def classify(evidence_root: Path, attempt_id: str, owner_uid: int = 0) -> str:
    """Only a valid NOT_AUTHORIZED record is recognized; all else quarantines."""
    if not isinstance(attempt_id, str) or not ATTEMPT.fullmatch(attempt_id):
        return 'UNCERTAIN'
    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location('ge04_trusted_path', Path(__file__).with_name('trusted-path.py'))
        walk = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(walk)
        fd = walk.open_trusted_directory(evidence_root, owner_uid)
        try:
            entry = os.open(attempt_id + '.json', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
            try:
                before = os.fstat(entry)
                if (not stat.S_ISREG(before.st_mode) or before.st_uid != owner_uid or
                        before.st_nlink != 1 or before.st_mode & 0o077 or before.st_size > 4096):
                    return 'UNCERTAIN'
                data = os.read(entry, 4097)
                after = os.fstat(entry)
                if len(data) > 4096 or (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                    return 'UNCERTAIN'
            finally:
                os.close(entry)
        finally:
            os.close(fd)
        record = json.loads(data)
        if (type(record) is not dict or set(record) != {'version', 'attemptId', 'state', 'helperSha256', 'admission'} or
                type(record['version']) is not int or record['version'] != 1 or record['attemptId'] != attempt_id or
                record['state'] != 'pre_spawn' or record['admission'] != 'NOT_AUTHORIZED' or
                not isinstance(record['helperSha256'], str) or not DIGEST.fullmatch(record['helperSha256'])):
            return 'UNCERTAIN'
        return 'NOT_AUTHORIZED'
    except (OSError, ValueError, TypeError, PermissionError, KeyError):
        return 'UNCERTAIN'
