#!/usr/bin/env python3
"""GE-04 protected fixture native-effect observation: NOT a true effect receipt.

The ROOT fixture controller supplies an observed native marker and pinned FD,
then records a create-once HMAC-bound inspection. Both key and evidence remain
controlled by the same privileged test owner. NEVER enable for production.
"""
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import stat

spec = importlib.util.spec_from_file_location(
    'ge04_native_credential', Path(__file__).with_name('fixture-credential-provisioning.py'))
credential = importlib.util.module_from_spec(spec)
spec.loader.exec_module(credential)

NAME = 'native-effect-observation.json'
LEAF = 'ge04-inert-effect.bin'
BODY = b'GE04_INERT_KERNEL_WRITE_NO_PRODUCTION_AUTHORITY\n'
ATTEMPT = 'fixed-kernel-attempt'
MARKER = 'GE04_NATIVE_FIXTURE_FSYNCED_UNVERIFIED'
LABEL = b'GE04-FIXTURE-NATIVE-OBSERVATION-V1\0'
FIELDS = {'version', 'attempt', 'approval', 'policyRevision', 'lease',
          'bodySha256', 'dev', 'inode', 'directoryDev', 'directoryInode',
          'observation', 'mac'}


def encode(data):
    return json.dumps(data, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def _exact_file(parent_fd):
    """Inspect the same pinned directory handle (never a re-resolved path)."""
    parent = os.fstat(parent_fd)
    if not stat.S_ISDIR(parent.st_mode):
        raise PermissionError('not a pinned directory')
    fd = os.open(LEAF, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent_fd)
    try:
        st = os.fstat(fd)
        if (not stat.S_ISREG(st.st_mode) or st.st_nlink != 1 or
                st.st_uid != os.geteuid() or st.st_mode & 0o077 or
                st.st_size != len(BODY)):
            raise PermissionError('native fixture effect not a protected regular file')
        raw = os.read(fd, len(BODY) + 1)
        after = os.fstat(fd)
        if (raw != BODY or (st.st_dev, st.st_ino, st.st_size, st.st_ctime_ns) !=
                (after.st_dev, after.st_ino, after.st_size, after.st_ctime_ns)):
            raise PermissionError('native fixture effect mismatch')
        return {'dev': st.st_dev, 'inode': st.st_ino,
                'directoryDev': parent.st_dev, 'directoryInode': parent.st_ino,
                'bodySha256': hashlib.sha256(raw).hexdigest()}
    finally:
        os.close(fd)


def _public(state, parent_fd):
    if (state['approvalState'] != 'consumed' or
            state['approvalId'] != 'approval' or state['leaseId'] != 'lease' or
            state['consumed'] != [ATTEMPT]):
        raise PermissionError('no single consumed fixture attempt')
    return {'version': 1, 'attempt': ATTEMPT,
            'approval': state['approvalId'],
            'policyRevision': state['policyRevision'],
            'lease': state['leaseId'],
            'observation': 'NATIVE_EFFECT_INSPECTED_UNVERIFIED',
            **_exact_file(parent_fd)}


def persist_locked(authority_fd, private, pinned_fd, state, native_stdout):
    """Caller MUST hold SUP-25 lock; create once, do not settle authority.

    The caller-controlled marker is NOT independently authenticated, so even
    verified HMAC means only fixture observation, never a real effect receipt.
    """
    if native_stdout != MARKER or state['inFlight'] != ATTEMPT:
        raise PermissionError('missing native terminal marker or live prepared attempt')
    key = credential.read_fixture_key(Path(private), os.geteuid())
    public = _public(state, pinned_fd)
    receipt = {**public,
               'mac': hmac.new(key, LABEL + encode(public), hashlib.sha256).hexdigest()}
    fd = os.open(NAME, os.O_WRONLY | os.O_CREAT | os.O_EXCL |
                 os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=authority_fd)
    try:
        raw = encode(receipt) + b'\n'
        if os.write(fd, raw) != len(raw):
            raise OSError('partial native observation write')
        os.fsync(fd)
    finally:
        os.close(fd)
    os.fsync(authority_fd)
    return 'GE04_NATIVE_OBSERVATION_DURABLE_UNVERIFIED'


def classify_locked(authority_fd, private, pinned_fd, state):
    """Even a matching protected observation never becomes a success receipt."""
    try:
        # An unclosed PREPARED transition is uncertain even if the marker was
        # persisted just before a process crash (no automatic settlement).
        if state['inFlight'] is not None:
            return 'UNCERTAIN_NO_REPLAY'
        public = _public(state, pinned_fd)
        fd = os.open(NAME, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
                     dir_fd=authority_fd)
        try:
            st = os.fstat(fd)
            if (not stat.S_ISREG(st.st_mode) or st.st_uid != os.geteuid() or
                    st.st_mode & 0o077 or st.st_nlink != 1 or
                    not 0 < st.st_size <= 2048):
                return 'UNCERTAIN_NO_REPLAY'
            raw = os.read(fd, 2049)
            if len(raw) != st.st_size:
                return 'UNCERTAIN_NO_REPLAY'
        finally:
            os.close(fd)
        def unique(pairs):
            out = {}
            for key, value in pairs:
                if key in out:
                    raise ValueError('duplicate observation field')
                out[key] = value
            return out
        obj = json.loads(raw, object_pairs_hook=unique)
        if type(obj) is not dict or set(obj) != FIELDS:
            return 'UNCERTAIN_NO_REPLAY'
        key = credential.read_fixture_key(Path(private), os.geteuid())
        expected = hmac.new(key, LABEL + encode(public), hashlib.sha256).hexdigest()
        if (type(obj['mac']) is not str or
                not hmac.compare_digest(obj['mac'], expected) or
                not hmac.compare_digest(encode({k: v for k, v in obj.items() if k != 'mac'}),
                                        encode(public))):
            return 'UNCERTAIN_NO_REPLAY'
        return 'GE04_NATIVE_EFFECT_OBSERVATION_MATCHED_UNVERIFIED'
    except (OSError, ValueError, TypeError, PermissionError, KeyError):
        return 'UNCERTAIN_NO_REPLAY'
