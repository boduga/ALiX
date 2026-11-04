#!/usr/bin/env python3
"""GE04 SUP-07: cooperative cross-process fence simulation, never authority.

All actors must voluntarily use this lock. The action is an inert marker,
not a governed mutation. State inputs are fixture-controlled and unauthenticated.
"""
import fcntl
import json
import os
from pathlib import Path
import secrets
import stat

FIELDS = {'version', 'policyRevision', 'leaseId', 'leaseState', 'expiresAtMs', 'inFlight'}

def _directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    st = os.fstat(fd)
    if st.st_uid != os.geteuid() or st.st_mode & 0o077:
        os.close(fd)
        raise PermissionError('fixture directory is not owner-only')
    return fd

def _write(fd, state):
    stage = '.sup07-stage-' + secrets.token_hex(12)
    entry = os.open(stage, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=fd)
    try:
        payload = json.dumps(state, sort_keys=True, separators=(',', ':')).encode() + b'\n'
        if os.write(entry, payload) != len(payload):
            raise OSError('short state write')
        os.fsync(entry)
    finally:
        os.close(entry)
    os.rename(stage, 'state.json', src_dir_fd=fd, dst_dir_fd=fd)
    os.fsync(fd)

def _read(fd):
    entry = os.open('state.json', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
    try:
        st = os.fstat(entry)
        if not stat.S_ISREG(st.st_mode) or st.st_uid != os.geteuid() or st.st_nlink != 1 or st.st_mode & 0o077 or st.st_size > 4096:
            raise PermissionError('untrusted fixture state')
        raw = os.read(entry, 4097)
        if len(raw) != st.st_size:
            raise ValueError('incomplete state')
    finally:
        os.close(entry)
    def no_duplicates(pairs):
        obj = {}
        for k, v in pairs:
            if k in obj:
                raise ValueError('duplicate state key')
            obj[k] = v
        return obj
    value = json.loads(raw, object_pairs_hook=no_duplicates)
    if (type(value) is not dict or set(value) != FIELDS or
            type(value['version']) is not int or value['version'] != 1 or
            type(value['policyRevision']) is not int or value['policyRevision'] < 0 or
            type(value['leaseId']) is not str or not value['leaseId'] or
            value['leaseState'] not in ('active', 'revoked', 'uncertain') or
            type(value['expiresAtMs']) is not int or
            (value['inFlight'] is not None and (type(value['inFlight']) is not str or not value['inFlight']))):
        raise ValueError('invalid fence state')
    return value

def _lock(fd):
    entry = os.open('.sup07.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=fd)
    st = os.fstat(entry)
    if not stat.S_ISREG(st.st_mode) or st.st_uid != os.geteuid() or st.st_nlink != 1 or st.st_mode & 0o077:
        os.close(entry)
        raise PermissionError('untrusted fence lock')
    fcntl.flock(entry, fcntl.LOCK_EX)
    return entry

def initialize(path: Path, lease_id: str, revision: int, expires: int):
    fd = _directory(path)
    try:
        lock = _lock(fd)
        try:
            try:
                os.stat('state.json', dir_fd=fd, follow_symlinks=False)
            except FileNotFoundError:
                _write(fd, {'version': 1, 'policyRevision': revision, 'leaseId': lease_id,
                            'leaseState': 'active', 'expiresAtMs': expires, 'inFlight': None})
            else:
                raise FileExistsError('state already initialized')
        finally:
            os.close(lock)
    finally:
        os.close(fd)

def fixture_mutation(path: Path, attempt: str, lease_id: str, revision: int, now_ms: int,
                     entered=None, resume=None, crash_after_prepare=False):
    """Hold cooperative lock through simulated write; returns UNVERIFIED only."""
    fd = _directory(path)
    try:
        lock = _lock(fd)
        try:
            state = _read(fd)
            if (type(now_ms) is not int or type(revision) is not int or
                    type(attempt) is not str or not attempt or
                    state['leaseState'] != 'active' or state['inFlight'] is not None or
                    state['leaseId'] != lease_id or state['policyRevision'] != revision or
                    now_ms >= state['expiresAtMs']):
                raise PermissionError('fixture authority mismatch or expired')
            state['inFlight'] = attempt
            _write(fd, state)
            if entered is not None: entered.set()
            if crash_after_prepare: os._exit(88)
            if resume is not None and not resume.wait(8):
                raise TimeoutError('fixture barrier timed out: outcome uncertain')
            # This is a benign diagnostic marker, NOT a filesystem mutation service.
            marker = os.open('marker-' + secrets.token_hex(8), os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=fd)
            try:
                os.write(marker, b'GE04_TEST_ONLY_UNVERIFIED\n')
                os.fsync(marker)
            finally:
                os.close(marker)
            os.fsync(fd)
            state['inFlight'] = None
            _write(fd, state)
            return 'PROCESS_OUTCOME_UNVERIFIED'
        finally:
            os.close(lock)
    finally:
        os.close(fd)

def revoke(path: Path, new_revision=None):
    """Cooperative revoker; never asserts that an in-flight crash did not write."""
    fd = _directory(path)
    try:
        lock = _lock(fd)
        try:
            state = _read(fd)
            if new_revision is not None:
                if type(new_revision) is not int or new_revision <= state['policyRevision']:
                    raise ValueError('policy revision must advance')
                state['policyRevision'] = new_revision
            state['leaseState'] = 'uncertain' if state['inFlight'] is not None else 'revoked'
            _write(fd, state)
            return state['leaseState'].upper()
        finally:
            os.close(lock)
    finally:
        os.close(fd)

def inspect(path: Path):
    fd = _directory(path)
    try:
        lock = _lock(fd)
        try:
            return _read(fd)
        finally:
            os.close(lock)
    finally:
        os.close(fd)
