#!/usr/bin/env python3
"""GE-04 test-only separate-custody journal anchor; NOT a trusted HW monotonic floor.

Root-only create-once checkpoint in a distinct, root-owned 0700 directory.
It is deliberately NOT an independently protected rollback anchor: root can
replace this directory and its records, and callers select the anchor path.
"""
import hashlib
import json
import os
import stat

NAME = 'lifecycle-anchor.json'
FIELDS = {'version', 'sequence', 'requestDigest', 'chainDigest'}
HEX = frozenset('0123456789abcdef')


def _directory(path):
    if os.geteuid() != 0:
        raise PermissionError('root-only experiment')
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    st = os.fstat(fd)
    if not stat.S_ISDIR(st.st_mode) or st.st_uid != 0 or st.st_mode & 0o777 != 0o700:
        os.close(fd)
        raise PermissionError('unprotected anchor directory')
    return fd


def _validate(record):
    if (type(record) is not dict or set(record) != FIELDS or
            type(record['version']) is not int or record['version'] != 1 or
            type(record['sequence']) is not int or record['sequence'] != 4 or
            any(type(record[k]) is not str or len(record[k]) != 64 or
                any(c not in HEX for c in record[k])
                for k in ('requestDigest', 'chainDigest'))):
        raise PermissionError('invalid anchor schema')


def publish(path, request_digest, chain_digest):
    """Write once; caller must have an independently completed chain."""
    record = {'version': 1, 'sequence': 4,
              'requestDigest': request_digest, 'chainDigest': chain_digest}
    _validate(record)
    fd = _directory(path)
    try:
        raw = json.dumps(record, sort_keys=True, separators=(',', ':')).encode() + b'\n'
        handle = os.open(NAME, os.O_WRONLY | os.O_CREAT | os.O_EXCL |
                         os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=fd)
        try:
            if os.write(handle, raw) != len(raw):
                raise OSError('short anchor write')
            os.fsync(handle)
        finally:
            os.close(handle)
        os.fsync(fd)
    finally:
        os.close(fd)


def matches(path, request_digest, chain_digest):
    """No authority or replay permission; true means local anchor matches."""
    try:
        fd = _directory(path)
        try:
            handle = os.open(NAME, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
                             dir_fd=fd)
            try:
                st = os.fstat(handle)
                if (not stat.S_ISREG(st.st_mode) or st.st_uid != 0 or
                        st.st_nlink != 1 or st.st_mode & 0o777 != 0o600 or
                        not 0 < st.st_size <= 512):
                    return False
                raw = os.read(handle, 513)
                if len(raw) != st.st_size:
                    return False
            finally:
                os.close(handle)
        finally:
            os.close(fd)
        def unique(pairs):
            result = {}
            for key, value in pairs:
                if key in result:
                    raise ValueError('duplicate anchor field')
                result[key] = value
            return result
        record = json.loads(raw, object_pairs_hook=unique)
        _validate(record)
        return (record['requestDigest'] == request_digest and
                record['chainDigest'] == chain_digest)
    except (OSError, ValueError, TypeError, PermissionError, UnicodeError):
        return False
