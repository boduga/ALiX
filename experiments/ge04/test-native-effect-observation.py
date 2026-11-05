#!/usr/bin/env python3
"""Unprivileged test of GE-04 native observation format; no kernel authority."""
import importlib.util
import os
from pathlib import Path
import tempfile

def load(name):
    spec = importlib.util.spec_from_file_location(
        'ge04_obstest_' + name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

auth = load('sup25-atomic-authority-fixture')
receipt = load('native-effect-observation-fixture')
keys = load('fixture-credential-provisioning')

with tempfile.TemporaryDirectory(prefix='ge04-native-observation-') as name:
    private = Path(name) / 'private'
    private.mkdir(mode=0o700)
    target = Path(name) / 'owned'
    target.mkdir(mode=0o700)
    keys.install_fixture_key(private)
    auth.initialize(private, revision=7, lease='lease', expiry=1000, approval='approval')
    (target / receipt.LEAF).write_bytes(receipt.BODY)
    (target / receipt.LEAF).chmod(0o600)
    rootfd = auth._directory(private)
    lock = auth._lock(rootfd)
    pinned = os.open(target, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        state = auth._load(rootfd)
        state['approvalState'] = 'consumed'
        state['inFlight'] = receipt.ATTEMPT
        state['consumed'] = [receipt.ATTEMPT]
        auth._save(rootfd, state)
        try:
            receipt.persist_locked(rootfd, private, pinned, state, 'WRONG_MARKER')
        except PermissionError:
            pass
        else:
            raise AssertionError('unauthenticated native marker accepted')
        assert not (private / receipt.NAME).exists()
        assert receipt.persist_locked(rootfd, private, pinned, state, receipt.MARKER) == (
            'GE04_NATIVE_OBSERVATION_DURABLE_UNVERIFIED')
        try:
            receipt.persist_locked(rootfd, private, pinned, state, receipt.MARKER)
        except FileExistsError:
            pass
        else:
            raise AssertionError('duplicate observation accepted')
        assert receipt.classify_locked(rootfd, private, pinned, state) == 'UNCERTAIN_NO_REPLAY'
        state['inFlight'] = None
        auth._save(rootfd, state)
        assert receipt.classify_locked(rootfd, private, pinned, state) == (
            'GE04_NATIVE_EFFECT_OBSERVATION_MATCHED_UNVERIFIED')
        (target / receipt.LEAF).write_bytes(b'ALTERED')
        assert receipt.classify_locked(rootfd, private, pinned, state) == 'UNCERTAIN_NO_REPLAY'
    finally:
        os.close(pinned)
        os.close(lock)
        os.close(rootfd)
print('GE04 native effect observation format PASS: marker rejection; create once; inFlight quarantined; tampering denied')
