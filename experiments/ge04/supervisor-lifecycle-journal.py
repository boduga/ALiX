#!/usr/bin/env python3
"""GE-04 versioned create-once fixture journal. Not a trusted rollback floor.

Caller must hold SUP-25 cooperative lock. Root-equivalent actors can rewrite
the journal and state; this is NOT independent provenance or production authority.
"""
import hashlib
import json
import os
import stat

STAGES = ('PREPARED', 'OBSERVED', 'SETTLED', 'SIGNED')
PREFIX = 'ge04-lifecycle-'
FIELDS = {'version', 'sequence', 'stage', 'requestDigest', 'previousDigest'}
ZERO = '0' * 64


def canonical(data):
    return json.dumps(data, sort_keys=True, separators=(',', ':'),
                      allow_nan=False).encode('utf-8')


def fingerprint(request):
    if type(request) is not dict or not request:
        raise ValueError('invalid request')
    return hashlib.sha256(b'ALiX-GE04-FIXED-REQUEST-v1\0' + canonical(request)).hexdigest()


def fixed_request(state, pinned_fd):
    info = os.fstat(pinned_fd)
    if not stat.S_ISDIR(info.st_mode):
        raise PermissionError('untrusted pinned directory')
    return dict(attemptId='fixed-kernel-attempt', approvalId='approval',
                leaseId='lease', policyRevision=7, operation='create',
                leaf='ge04-inert-effect.bin',
                bodySha256=hashlib.sha256(
                    b'GE04_INERT_KERNEL_WRITE_NO_PRODUCTION_AUTHORITY\n').hexdigest(),
                directoryDev=info.st_dev, directoryInode=info.st_ino)


def _read(fd, index):
    h = os.open(PREFIX + str(index) + '.json',
                os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
    try:
        st = os.fstat(h)
        if (not stat.S_ISREG(st.st_mode) or st.st_uid != os.geteuid() or
                st.st_mode & 0o077 or st.st_nlink != 1 or
                not 0 < st.st_size <= 1024):
            raise PermissionError('untrusted journal record')
        raw = os.read(h, 1025)
        if len(raw) != st.st_size:
            raise PermissionError('partial journal record')
    finally:
        os.close(h)
    def unique(pairs):
        out = {}
        for key, value in pairs:
            if key in out:
                raise ValueError('duplicate journal key')
            out[key] = value
        return out
    record = json.loads(raw, object_pairs_hook=unique,
                        parse_constant=lambda _: (_ for _ in ()).throw(ValueError('nonfinite')))
    if (type(record) is not dict or set(record) != FIELDS or
            type(record['version']) is not int or record['version'] != 1 or
            type(record['sequence']) is not int or record['sequence'] != index or
            type(record['stage']) is not str or record['stage'] != STAGES[index - 1] or
            any(type(record[key]) is not str or len(record[key]) != 64 or
                any(ch not in '0123456789abcdef' for ch in record[key])
                for key in ('requestDigest', 'previousDigest'))):
        raise PermissionError('invalid journal schema')
    return record, raw


def read_chain(fd, request_digest):
    """Contiguous, locally hash-linked only; cannot detect full-tree rollback."""
    if type(request_digest) is not str or len(request_digest) != 64:
        raise ValueError('invalid request hash')
    previous = ZERO
    records = []
    missing = False
    for index in range(1, len(STAGES) + 1):
        try:
            record, raw = _read(fd, index)
        except FileNotFoundError:
            missing = True
            continue
        if missing or record['previousDigest'] != previous or record['requestDigest'] != request_digest:
            raise PermissionError('journal gap or binding mismatch')
        previous = hashlib.sha256(raw).hexdigest()
        records.append(record)
    return records, previous


def append(fd, request_digest, stage):
    """Append under already held authority lock; fsync file and directory."""
    if stage not in STAGES:
        raise ValueError('unknown lifecycle stage')
    records, previous = read_chain(fd, request_digest)
    index = len(records) + 1
    if index > len(STAGES) or STAGES[index - 1] != stage:
        raise PermissionError('out of order journal transition')
    record = dict(version=1, sequence=index, stage=stage,
                  requestDigest=request_digest, previousDigest=previous)
    raw = canonical(record) + b'\n'
    handle = os.open(PREFIX + str(index) + '.json',
                     os.O_WRONLY | os.O_CREAT | os.O_EXCL |
                     os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=fd)
    try:
        if os.write(handle, raw) != len(raw):
            raise OSError('short journal write')
        os.fsync(handle)
    finally:
        os.close(handle)
    os.fsync(fd)


def classify(fd, request_digest):
    try:
        records, _ = read_chain(fd, request_digest)
        return 'CHAIN_COMPLETE_UNVERIFIED' if len(records) == len(STAGES) else 'UNCERTAIN_NO_REPLAY'
    except (OSError, ValueError, TypeError, KeyError, PermissionError):
        return 'UNCERTAIN_NO_REPLAY'
