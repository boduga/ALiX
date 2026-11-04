#!/usr/bin/env python3
"""GE-04 SUP-03: fsynced observation of an UNVERIFIED child outcome.

This is NOT an authenticated terminal receipt. Every record denotes uncertainty;
neither PID status, forged stdout, nor a worker-supplied notification proves success.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat


def _load(name):
    spec = importlib.util.spec_from_file_location('ge04_' + name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _read_prespawn(fd, attempt, owner_uid):
    handle = os.open(attempt + '.json', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
    try:
        before = os.fstat(handle)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != owner_uid or
                before.st_nlink != 1 or before.st_mode & 0o077 or before.st_size > 4096):
            raise PermissionError('untrusted pre-spawn evidence')
        data = os.read(handle, 4097)
        after = os.fstat(handle)
        if len(data) > 4096 or (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
                after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            raise PermissionError('pre-spawn evidence changed')
        return data
    finally:
        os.close(handle)


def record_unverified(evidence: Path, attempt_id: str, outcome: str,
                      owner_uid: int = 0) -> None:
    """Exclusive durable observation; never a success receipt or replay grant."""
    valid_outcomes = frozenset({
        'PROCESS_EXIT_ZERO_UNVERIFIED', 'PROCESS_EXIT_NONZERO_UNVERIFIED',
        'PROCESS_SIGNALED_UNVERIFIED', 'PROCESS_IDENTITY_UNVERIFIED',
        'PROCESS_OUTCOME_UNVERIFIED'
    })
    if outcome not in valid_outcomes:
        raise ValueError('unrecognized or claimed-success outcome')
    recovery = _load('supervisor-ledger-reconcile')
    if recovery.classify(evidence, attempt_id, owner_uid) != 'NOT_AUTHORIZED':
        raise PermissionError('untrusted pre-spawn record')
    fd = _load('trusted-path').open_trusted_directory(evidence, owner_uid)
    try:
        # Denial and terminal observations cannot coexist without quarantine.
        try:
            os.stat(attempt_id + '.denied', dir_fd=fd, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            raise PermissionError('attempt already denied')
        prespawn = _read_prespawn(fd, attempt_id, owner_uid)
        payload = json.dumps({
            'version': 1, 'attemptId': attempt_id,
            'state': 'UNVERIFIED', 'observedOutcome': outcome,
            'preSpawnSha256': hashlib.sha256(prespawn).hexdigest(),
            'admission': 'NOT_AUTHORIZED'
        }, sort_keys=True, separators=(',', ':')).encode() + b'\n'
        out = os.open(attempt_id + '.unverified', os.O_WRONLY | os.O_CREAT | os.O_EXCL |
                      os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=fd)
        try:
            remaining = memoryview(payload)
            while remaining:
                count = os.write(out, remaining)
                if count <= 0:
                    raise OSError('short observation write')
                remaining = remaining[count:]
            os.fsync(out)
        finally:
            os.close(out)
        os.fsync(fd)
    finally:
        os.close(fd)


def classify_unverified(evidence: Path, attempt_id: str, owner_uid: int = 0) -> str:
    """Never promotes any observation to successful execution."""
    try:
        recovery = _load('supervisor-ledger-reconcile')
        if recovery.classify(evidence, attempt_id, owner_uid) != 'NOT_AUTHORIZED':
            return 'UNCERTAIN'
        fd = _load('trusted-path').open_trusted_directory(evidence, owner_uid)
        try:
            prespawn = _read_prespawn(fd, attempt_id, owner_uid)
            entry = os.open(attempt_id + '.unverified', os.O_RDONLY | os.O_NOFOLLOW |
                            os.O_CLOEXEC, dir_fd=fd)
            try:
                before = os.fstat(entry)
                if (not stat.S_ISREG(before.st_mode) or before.st_uid != owner_uid or
                        before.st_nlink != 1 or before.st_mode & 0o077 or before.st_size > 4096):
                    return 'UNCERTAIN'
                data = os.read(entry, 4097)
                after = os.fstat(entry)
                if len(data) > 4096 or (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
                        after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                    return 'UNCERTAIN'
            finally:
                os.close(entry)
            try:
                os.stat(attempt_id + '.denied', dir_fd=fd, follow_symlinks=False)
            except FileNotFoundError:
                pass
            else:
                return 'UNCERTAIN'
        finally:
            os.close(fd)

        def unique(pairs):
            result = {}
            for key, value in pairs:
                if key in result:
                    raise ValueError('duplicate evidence key')
                result[key] = value
            return result

        obj = json.loads(data, object_pairs_hook=unique)
        if (type(obj) is not dict or set(obj) != {'version', 'attemptId', 'state', 'observedOutcome',
                                                 'preSpawnSha256', 'admission'} or
                type(obj['version']) is not int or obj['version'] != 1 or
                obj['attemptId'] != attempt_id or obj['state'] != 'UNVERIFIED' or
                obj['admission'] != 'NOT_AUTHORIZED' or
                obj['observedOutcome'] not in frozenset({
                    'PROCESS_EXIT_ZERO_UNVERIFIED', 'PROCESS_EXIT_NONZERO_UNVERIFIED',
                    'PROCESS_SIGNALED_UNVERIFIED', 'PROCESS_IDENTITY_UNVERIFIED',
                    'PROCESS_OUTCOME_UNVERIFIED'}) or
                obj['preSpawnSha256'] != hashlib.sha256(prespawn).hexdigest()):
            return 'UNCERTAIN'
        return 'UNVERIFIED'
    except (OSError, ValueError, TypeError, KeyError, PermissionError):
        return 'UNCERTAIN'
