#!/usr/bin/env python3
"""SUP-25 inert single-owner authorization state machine.

A separately-provisioned supervisor would need to own this state. This
fixture only demonstrates ordered, durable approval/lease/revocation checks;
it does NOT authorize a real operation or provide trusted provisioning.
"""
import fcntl
import json
import os
from pathlib import Path
import secrets
import stat

FIELDS = {'version', 'policyRevision', 'leaseId', 'expiresAtMs',
          'revoked', 'approvalId', 'approvalState', 'inFlight', 'consumed'}


def _directory(directory):
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    meta = os.fstat(fd)
    if not stat.S_ISDIR(meta.st_mode) or meta.st_uid != os.geteuid() or meta.st_mode & 0o077:
        os.close(fd)
        raise PermissionError('unsafe authority fixture root')
    return fd


def _lock(fd):
    handle = os.open('.sup25.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC,
                     0o600, dir_fd=fd)
    meta = os.fstat(handle)
    if (not stat.S_ISREG(meta.st_mode) or meta.st_uid != os.geteuid() or
            meta.st_nlink != 1 or meta.st_mode & 0o077):
        os.close(handle)
        raise PermissionError('unsafe authority fixture lock')
    fcntl.flock(handle, fcntl.LOCK_EX)
    return handle


def _load(fd):
    handle = os.open('state.json', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
    try:
        meta = os.fstat(handle)
        if (not stat.S_ISREG(meta.st_mode) or meta.st_uid != os.geteuid() or
                meta.st_nlink != 1 or meta.st_mode & 0o077 or meta.st_size > 4096):
            raise PermissionError('unsafe authority fixture state')
        raw = os.read(handle, 4097)
        if len(raw) != meta.st_size:
            raise PermissionError('partial authority state')
    finally:
        os.close(handle)

    def unique(pairs):
        out = {}
        for key, value in pairs:
            if key in out:
                raise PermissionError('duplicate authority state field')
            out[key] = value
        return out

    state = json.loads(raw, object_pairs_hook=unique)
    if (type(state) is not dict or set(state) != FIELDS or
            type(state['version']) is not int or state['version'] != 1 or
            type(state['policyRevision']) is not int or state['policyRevision'] < 0 or
            type(state['expiresAtMs']) is not int or
            type(state['revoked']) is not bool or
            type(state['leaseId']) is not str or not state['leaseId'] or
            type(state['approvalId']) is not str or not state['approvalId'] or
            state['approvalState'] not in ('approved', 'denied', 'consumed') or
            type(state['consumed']) is not list or
            len(state['consumed']) > 64 or
            any(type(x) is not str or not x for x in state['consumed']) or
            len(set(state['consumed'])) != len(state['consumed']) or
            (state['inFlight'] is not None and
             (type(state['inFlight']) is not str or not state['inFlight']))):
        raise PermissionError('invalid authority state')
    return state


def _save(fd, state):
    stage = '.sup25-' + secrets.token_hex(12)
    handle = os.open(stage, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                     0o600, dir_fd=fd)
    try:
        raw = json.dumps(state, sort_keys=True, separators=(',', ':')).encode() + b'\n'
        if len(raw) > 4096 or os.write(handle, raw) != len(raw):
            raise OSError('state write failed')
        os.fsync(handle)
    finally:
        os.close(handle)
    os.rename(stage, 'state.json', src_dir_fd=fd, dst_dir_fd=fd)
    os.fsync(fd)


def initialize(directory, *, revision, lease, expiry, approval):
    if (type(revision) is not int or revision < 0 or type(expiry) is not int or
            type(lease) is not str or not lease or
            type(approval) is not str or not approval):
        raise ValueError('invalid fixture initial state')
    fd = _directory(directory)
    try:
        lock = _lock(fd)
        try:
            try:
                os.stat('state.json', dir_fd=fd, follow_symlinks=False)
            except FileNotFoundError:
                _save(fd, dict(version=1, policyRevision=revision, leaseId=lease,
                               expiresAtMs=expiry, revoked=False, approvalId=approval,
                               approvalState='approved', inFlight=None, consumed=[]))
            else:
                raise FileExistsError('authority state already exists')
        finally:
            os.close(lock)
    finally:
        os.close(fd)


def attempt(directory, *, attempt_id, approval, lease, revision, now_ms,
            entered=None, resume=None, crash=False):
    """Inert transition. Never returns SUCCESS or an authorization receipt."""
    if type(attempt_id) is not str or not attempt_id or type(now_ms) is not int:
        raise ValueError('invalid attempt metadata')
    fd = _directory(directory)
    try:
        lock = _lock(fd)
        try:
            state = _load(fd)
            if (state['revoked'] or state['approvalState'] != 'approved' or
                    state['approvalId'] != approval or state['leaseId'] != lease or
                    state['policyRevision'] != revision or now_ms >= state['expiresAtMs'] or
                    state['inFlight'] is not None or attempt_id in state['consumed'] or
                    len(state['consumed']) == 64):
                raise PermissionError('supervisor fixture authorization denied')
            # Persist before any simulated execution. Crash is UNCERTAIN,
            # not a reusable approval and not proof of an effect.
            state['inFlight'] = attempt_id
            state['approvalState'] = 'consumed'
            state['consumed'].append(attempt_id)
            _save(fd, state)
            if entered is not None:
                entered.set()
            if crash:
                os._exit(88)
            if resume is not None and not resume.wait(8):
                raise TimeoutError('fixture transition suspended: UNCERTAIN')
            state['inFlight'] = None
            _save(fd, state)
            return 'SUP25_INERT_OUTCOME_UNVERIFIED'
        finally:
            os.close(lock)
    finally:
        os.close(fd)


def revoke(directory, revision):
    fd = _directory(directory)
    try:
        lock = _lock(fd)
        try:
            state = _load(fd)
            if type(revision) is not int or revision <= state['policyRevision']:
                raise ValueError('revocation must advance revision')
            state['policyRevision'] = revision
            state['revoked'] = True
            _save(fd, state)
            return 'SUP25_REVOKED_UNVERIFIED'
        finally:
            os.close(lock)
    finally:
        os.close(fd)


def inspect(directory):
    fd = _directory(directory)
    try:
        lock = _lock(fd)
        try:
            return _load(fd)
        finally:
            os.close(lock)
    finally:
        os.close(fd)
