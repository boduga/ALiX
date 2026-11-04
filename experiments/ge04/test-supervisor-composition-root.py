#!/usr/bin/env python3
"""GE04 SUP-08 root-only inert cross-process composition qualification."""
import hashlib
import importlib.util
import json
import multiprocessing as mp
import os
from pathlib import Path
import tempfile

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

if os.geteuid() != 0:
    raise SystemExit('GE04 SUP-08 test requires root, not a skipped pass')


def load(name):
    spec = importlib.util.spec_from_file_location('ge04_' + name.replace('-', '_'),
                                                  Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


integration = load('supervisor-composition-fixture')
fence = load('cooperative-revocation-fence')
signer = Ed25519PrivateKey.generate()
public = signer.public_key().public_bytes(serialization.Encoding.Raw,
                                          serialization.PublicFormat.Raw)
pin = hashlib.sha256(public).hexdigest()
claim = {
    'version': 1, 'attemptId': 'attempt-one', 'approvalId': 'approval-one',
    'leaseId': 'lease-one', 'workerId': 'worker-one',
    'policyRevision': 7, 'invocationSha256': hashlib.sha256(b'inert').hexdigest(),
    'ownedPath': '/authorized/never-used', 'nonce': 'nonce-one',
    'issuedAtMs': 100, 'expiresAtMs': 500
}
expected = {k: v for k, v in claim.items()
            if k not in ('version', 'nonce', 'issuedAtMs', 'expiresAtMs')}


def envelope(doc):
    raw = json.dumps(doc, sort_keys=True, separators=(',', ':')).encode()
    return raw, signer.sign(raw)


def setup(root, name):
    path = root / name
    path.mkdir(mode=0o700)
    (path / 'claims').mkdir(mode=0o700)
    (path / 'fence').mkdir(mode=0o700)
    fence.initialize(path / 'fence', 'lease-one', 7, 500)
    return path


def invoke(root, doc=claim, **kwargs):
    raw, sig = envelope(doc)
    return integration.simulate(root, raw, sig, public, pin, expected,
                                200, False, 0, **kwargs)


def denied(fn, name):
    try:
        fn()
    except (PermissionError, FileExistsError):
        return
    raise AssertionError('invalid fixture admitted: ' + name)


with tempfile.TemporaryDirectory(prefix='ge04-sup08-', dir='/run') as folder:
    base = Path(folder)
    base.chmod(0o700)
    root = setup(base, 'normal')
    assert invoke(root) == 'PROCESS_OUTCOME_UNVERIFIED'
    raw, _ = envelope(claim)
    assert integration.inspect(root, claim['nonce'], raw) == 'UNCERTAIN'
    assert len(list((root / 'fence').glob('marker-*'))) == 1
    denied(lambda: invoke(root), 'replayed signature/nonce')
    assert len(list((root / 'fence').glob('marker-*'))) == 1

    # An altered worker/operation signature must fail before reservation.
    modified = dict(claim, workerId='attacker-worker', nonce='attacker-nonce')
    denied(lambda: invoke(setup(base, 'forgery'), modified), 'mismatched binding')

    # A signed but revoked/stale policy must not cross the fence.
    stale = setup(base, 'stale')
    fence.revoke(stale / 'fence', 8)
    denied(lambda: invoke(stale), 'revocation won')
    assert not list((stale / 'fence').glob('marker-*'))
    assert integration.inspect(stale, claim['nonce'], raw) == 'UNCERTAIN'
    denied(lambda: invoke(stale), 'reserved revoked attempt replay')

    # Crash after exclusive claim creation: uncertain reservation, no marker.
    crash = setup(base, 'crash-reservation')
    child = mp.Process(target=invoke, args=(crash,),
                       kwargs={'fixture_crash_after_reservation': True})
    child.start(); child.join(10)
    assert child.exitcode == 89
    assert not list((crash / 'fence').glob('marker-*'))
    assert integration.inspect(crash, claim['nonce'], raw) == 'UNCERTAIN'
    denied(lambda: invoke(crash), 'crash reservation replay')

    # Crash after durable in-flight publication: state quarantined, no replay.
    active = setup(base, 'crash-fence')
    child = mp.Process(target=invoke, args=(active,),
                       kwargs={'fixture_crash_after_fence_prepare': True})
    child.start(); child.join(10)
    assert child.exitcode == 88
    assert fence.inspect(active / 'fence')['inFlight'] == 'attempt-one'
    assert fence.revoke(active / 'fence', 8) == 'UNCERTAIN'
    assert integration.inspect(active, claim['nonce'], raw) == 'UNCERTAIN'
    denied(lambda: invoke(active), 'in-flight crash replay')
    assert not list((active / 'fence').glob('marker-*'))

print('GE04 SUP-08 inert supervisor composition PASS: bound stages, revoked gate, replay and crashes quarantined')
