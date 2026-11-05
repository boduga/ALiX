#!/usr/bin/env python3
"""SUP-26 inert terminal observation record: HMAC fixture evidence, never effect proof.

A MAC under a fixture-controlled key does not establish independent authority.
Unknown or interrupted outcomes must remain UNCERTAIN; do not retry.
"""
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import stat

def load(filename):
    spec = importlib.util.spec_from_file_location(
        'sup26_' + filename.replace('-', '_'),
        Path(__file__).with_name(filename + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

authority = load('sup25-atomic-authority-fixture')
credential = load('fixture-credential-provisioning')
LABEL = b'GE04-SUP26-INERT-OBSERVATION-V1\0'
RECEIPT = 'terminal-observation.json'
FIELDS = {'version', 'attemptId', 'stateSha256', 'observation', 'mac'}


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def _key(directory):
    return credential.read_fixture_key(directory, os.geteuid())


def _record(state, attempt_id, key):
    public = {'version': 1, 'attemptId': attempt_id,
              'stateSha256': hashlib.sha256(encode(state)).hexdigest(),
              'observation': 'INERT_TRANSITION_OBSERVED_UNVERIFIED'}
    return {**public, 'mac': hmac.new(key, LABEL + encode(public), hashlib.sha256).hexdigest()}


def _validated(directory, state, attempt_id):
    if (type(attempt_id) is not str or not attempt_id or
            state['inFlight'] is not None or state['approvalState'] != 'consumed' or
            state['consumed'] != [attempt_id]):
        raise PermissionError('no completed inert fixture transition')
    return _record(state, attempt_id, _key(directory))


def persist_observation(directory, attempt_id):
    """Create exactly once after a cooperatively completed inert transition."""
    fd = authority._directory(directory)
    try:
        lock = authority._lock(fd)
        try:
            state = authority._load(fd)
            record = _validated(directory, state, attempt_id)
            handle = os.open(RECEIPT, os.O_WRONLY | os.O_CREAT | os.O_EXCL |
                             os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=fd)
            try:
                payload = encode(record) + b'\n'
                if os.write(handle, payload) != len(payload):
                    raise OSError('incomplete inert observation write')
                os.fsync(handle)
            finally:
                os.close(handle)
            os.fsync(fd)
            return 'SUP26_INERT_RECORD_PERSISTED_UNVERIFIED'
        finally:
            os.close(lock)
    finally:
        os.close(fd)


def classify(directory, attempt_id):
    """Never return a verified mutation success, even with a matching MAC."""
    try:
        fd = authority._directory(directory)
        try:
            lock = authority._lock(fd)
            try:
                state = authority._load(fd)
                expected = _validated(directory, state, attempt_id)
                handle = os.open(RECEIPT, os.O_RDONLY | os.O_NOFOLLOW |
                                 os.O_CLOEXEC, dir_fd=fd)
                try:
                    st = os.fstat(handle)
                    if (not stat.S_ISREG(st.st_mode) or st.st_uid != os.geteuid() or
                            st.st_nlink != 1 or st.st_mode & 0o077 or
                            not 0 < st.st_size <= 4096):
                        return 'UNCERTAIN'
                    raw = os.read(handle, 4097)
                    if len(raw) != st.st_size:
                        return 'UNCERTAIN'
                finally:
                    os.close(handle)
                def unique(pairs):
                    out = {}
                    for k, v in pairs:
                        if k in out:
                            raise ValueError('duplicate observation field')
                        out[k] = v
                    return out
                evidence = json.loads(raw, object_pairs_hook=unique)
                if (type(evidence) is not dict or set(evidence) != FIELDS or
                        any(type(value) is not type(expected[key]) for key, value in evidence.items()) or
                        not hmac.compare_digest(encode(evidence), encode(expected))):
                    return 'UNCERTAIN'
                return 'INERT_RECORD_MATCHED_EFFECT_UNVERIFIED'
            finally:
                os.close(lock)
        finally:
            os.close(fd)
    except (OSError, ValueError, PermissionError, KeyError, TypeError):
        return 'UNCERTAIN'
