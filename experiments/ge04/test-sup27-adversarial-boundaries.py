#!/usr/bin/env python3
"""SUP-27 adversarial fixtures: demonstrate untrusted-coordinator bypasses.

Expected reproductions must remain red security findings, not declarations
that the experimental gates provide production authorization or effect proof.
All operations are inside isolated temporary directories and are inert.
"""
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import tempfile


def load(name):
    spec = importlib.util.spec_from_file_location(
        'ge04_sup27_' + name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


authority = load('sup25-atomic-authority-fixture')
evidence = load('sup26-inert-terminal-evidence')
keys = load('fixture-credential-provisioning')


def setup(base, name):
    directory = base / name
    directory.mkdir(mode=0o700)
    assert keys.install_fixture_key(directory) == 'KEY_FIXTURE_INSTALLED_UNTRUSTED'
    authority.initialize(directory, revision=7, lease='lease', expiry=1000, approval='approval')
    return directory


def rewrite_as_fixture_owner(directory, change):
    # This is the deliberately hostile same-UID actor, NOT an intended API.
    # The fixture does not have an OS-enforced authority boundary.
    fd = authority._directory(directory)
    try:
        lock = authority._lock(fd)
        try:
            state = authority._load(fd)
            change(state)
            authority._save(fd, state)
            return state
        finally:
            os.close(lock)
    finally:
        os.close(fd)


with tempfile.TemporaryDirectory(prefix='ge04-sup27-adversarial-') as directory:
    base = Path(directory)
    base.chmod(0o700)

    # Finding 1: same-UID state writer can undo a revocation. The "atomic"
    # lock prevents concurrent cooperative races, not malicious rewrites.
    revoked = setup(base, 'revocation-rewrite')
    assert authority.revoke(revoked, 8) == 'SUP25_REVOKED_UNVERIFIED'
    def bypass_revocation(state):
        state['revoked'] = False
        state['policyRevision'] = 7
    rewrite_as_fixture_owner(revoked, bypass_revocation)
    assert authority.attempt(
        revoked, attempt_id='attempt', approval='approval', lease='lease',
        revision=7, now_ms=100) == 'SUP25_INERT_OUTCOME_UNVERIFIED'
    print('GE04 SUP-27 FINDING-1 REPRODUCED: same-UID actor rewrote revoked authority fixture')

    # Finding 2: anyone who controls the fixture directory and key can
    # fabricate a state and a matching authenticated-looking terminal record,
    # without ever calling SUP-25's attempt path.
    forged = setup(base, 'forged-terminal-record')
    def fabricate_completion(state):
        state['approvalState'] = 'consumed'
        state['inFlight'] = None
        state['consumed'] = ['never-executed']
    fabricated_state = rewrite_as_fixture_owner(forged, fabricate_completion)
    secret = keys.read_fixture_key(forged, os.geteuid())
    public = {
        'version': 1,
        'attemptId': 'never-executed',
        'stateSha256': hashlib.sha256(evidence.encode(fabricated_state)).hexdigest(),
        'observation': 'INERT_TRANSITION_OBSERVED_UNVERIFIED',
    }
    forged_record = {
        **public,
        'mac': hmac.new(secret, evidence.LABEL + evidence.encode(public),
                        hashlib.sha256).hexdigest(),
    }
    (forged / evidence.RECEIPT).write_bytes(evidence.encode(forged_record) + b'\n')
    os.chmod(forged / evidence.RECEIPT, 0o600)
    assert evidence.classify(forged, 'never-executed') == 'INERT_RECORD_MATCHED_EFFECT_UNVERIFIED'
    print('GE04 SUP-27 FINDING-2 REPRODUCED: same-UID actor forged matching inert terminal evidence')

    # Finding 3: a filesystem-integrity marker remains an UNVERIFIED
    # observation even after cooperative legitimate completion.
    honest = setup(base, 'honest-observation')
    assert authority.attempt(
        honest, attempt_id='attempt', approval='approval', lease='lease',
        revision=7, now_ms=100) == 'SUP25_INERT_OUTCOME_UNVERIFIED'
    assert evidence.persist_observation(honest, 'attempt') == 'SUP26_INERT_RECORD_PERSISTED_UNVERIFIED'
    assert evidence.classify(honest, 'attempt') == 'INERT_RECORD_MATCHED_EFFECT_UNVERIFIED'
    print('GE04 SUP-27 FINDING-3 CONFIRMED: matching observation never certifies actual effect')

print('GE04 SUP-27 adversarial reproductions PASS: forged state and receipt demonstrated; production security hold REQUIRED')
