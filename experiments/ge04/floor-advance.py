#!/usr/bin/env python3
"""Isolated cooperative crash-durable floor update prototype; not production authority."""
import fcntl
import json
import os
import secrets
from pathlib import Path


def advance(directory: Path, candidate: int | None, owner_uid: int = 0, candidate_provider=None) -> int:
    """When provided, derive the candidate under the same cooperative update lock."""
    if candidate_provider is not None and candidate is not None:
        raise ValueError('ambiguous candidate source')
    if candidate_provider is None and (type(candidate) is not int or not 0 <= candidate <= 2**63 - 1):
        raise ValueError('invalid sequence')
    import importlib.util
    spec = importlib.util.spec_from_file_location('ge04_floor', Path(__file__).with_name('release-floor.py'))
    floor = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(floor)
    walk = floor.load('trusted-path')
    reader = floor.load('signed-installation')
    fd = walk.open_trusted_directory(directory, owner_uid)
    try:
        lock = os.open('.floor-update.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=fd)
        try:
            metadata = os.fstat(lock)
            import stat
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != owner_uid or metadata.st_nlink != 1 or metadata.st_mode & 0o077:
                raise PermissionError('untrusted update lock')
            fcntl.flock(lock, fcntl.LOCK_EX)
            if candidate_provider is not None:
                candidate = candidate_provider()
                if type(candidate) is not int or not 0 <= candidate <= 2**63 - 1:
                    raise ValueError('invalid authenticated sequence')
            record = json.loads(reader.read_protected_file(fd, 'floor.json', owner_uid, 4096))
            if set(record) != {'version', 'minimumSequence'} or type(record['version']) is not int or record['version'] != 1 or type(record['minimumSequence']) is not int or not 0 <= record['minimumSequence'] <= 2**63 - 1:
                raise ValueError('invalid existing floor')
            old = record['minimumSequence']
            if candidate < old:
                raise PermissionError('floor regression denied')
            if candidate == old:
                return old
            name = '.floor-stage-' + secrets.token_hex(12)
            temp = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o400, dir_fd=fd)
            try:
                payload = json.dumps({'version': 1, 'minimumSequence': candidate}).encode()
                if os.write(temp, payload) != len(payload):
                    raise OSError('short floor write')
                os.fsync(temp)
            finally:
                os.close(temp)
            os.rename(name, 'floor.json', src_dir_fd=fd, dst_dir_fd=fd)
            os.fsync(fd)
            return candidate
        finally:
            os.close(lock)
    finally:
        os.close(fd)
