#!/usr/bin/env python3
"""GE04 SUP-06 adversarial reservation fixture. Root-only, no execution."""
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
    raise SystemExit('GE04 SUP-06 root-only test required')

def load(name):
    spec = importlib.util.spec_from_file_location('ge04_' + name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

store = load('single-use-claim-reservation')
key = Ed25519PrivateKey.generate()
public = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
pin = hashlib.sha256(public).hexdigest()
claim = {'version': 1, 'attemptId': 'attempt-1', 'approvalId': 'approval-1',
         'leaseId': 'lease-1', 'workerId': 'worker-1', 'policyRevision': 15,
         'invocationSha256': hashlib.sha256(b'harmless fixture').hexdigest(),
         'ownedPath': '/authorized/harmless', 'nonce': 'unique-nonce-1',
         'issuedAtMs': 100000, 'expiresAtMs': 110000}
expected = {key: value for key, value in claim.items()
            if key not in ('version', 'nonce', 'issuedAtMs', 'expiresAtMs')}
def signed(doc):
    raw = json.dumps(doc, sort_keys=True, separators=(',', ':')).encode()
    return raw, key.sign(raw)

def reserve(root, doc, **kwargs):
    raw, sig = signed(doc)
    return store.reserve_claim(root, raw, sig, public, pin, expected, 105000, False, 0, **kwargs)

def contender(root, doc, start, queue):
    start.wait()
    try:
        queue.put(('ok', reserve(root, doc)))
    except BaseException as exc:
        queue.put(('denied', type(exc).__name__))

with tempfile.TemporaryDirectory(prefix='ge04-sup06-', dir='/run') as name:
    root = Path(name)
    root.chmod(0o700)
    reservation = root / 'protected'
    reservation.mkdir(mode=0o700)
    raw, _ = signed(claim)
    assert store.classify_reservation(reservation, claim['nonce'], raw) == 'UNCERTAIN'
    start = mp.Event()
    queue = mp.Queue()
    workers = [mp.Process(target=contender, args=(reservation, claim, start, queue)) for _ in range(8)]
    for worker in workers:
        worker.start()
    start.set()
    outcomes = [queue.get(timeout=10) for _ in workers]
    for worker in workers:
        worker.join(10)
        assert worker.exitcode == 0
    assert outcomes.count(('ok', 'TEST_RESERVED_UNTRUSTED')) == 1, outcomes
    assert len([x for x in outcomes if x[0] == 'denied']) == 7, outcomes
    assert store.classify_reservation(reservation, claim['nonce'], raw) == 'RESERVED_UNTRUSTED'
    try:
        reserve(reservation, claim)
    except FileExistsError:
        pass
    else:
        raise AssertionError('signed envelope replay was accepted')

    # A different signed attempt sharing a nonce must not get a second reservation.
    swapped = dict(claim, attemptId='attempt-2')
    swapped_expected = dict(expected, attemptId='attempt-2')
    changed, signed_changed = signed(swapped)
    try:
        store.reserve_claim(reservation, changed, signed_changed, public, pin,
                            swapped_expected, 105000, False, 0)
    except FileExistsError:
        pass
    else:
        raise AssertionError('nonce collision across attempts accepted')
    for kwargs in ({'revoked': True}, {'now_ms': 110000}):
        try:
            store.reserve_claim(reservation, raw, key.sign(raw),
                                public, pin, expected, kwargs.get('now_ms', 105000),
                                kwargs.get('revoked', False), 0)
        except PermissionError:
            pass
        else:
            raise AssertionError('invalid authority state reserved')

    crashed = dict(claim, nonce='crash-unique-nonce')
    process = mp.Process(target=reserve, args=(reservation, crashed),
                         kwargs={'fixture_crash_after_create': True})
    process.start()
    process.join(10)
    assert process.exitcode == 89, process.exitcode
    crash_raw, _ = signed(crashed)
    assert store.classify_reservation(reservation, crashed['nonce'], crash_raw) == 'UNCERTAIN'
    try:
        reserve(reservation, crashed)
    except FileExistsError:
        pass
    else:
        raise AssertionError('crash-created reservation replayed')
    # Two reservations coexist; only the exact nonce-derived entry is targeted.
    # Directory iteration order must never decide which claim is tampered with.
    file = reservation / store._name(claim['nonce'])
    other = reservation / store._name(crashed['nonce'])
    assert file != other and file.is_file() and other.is_file()
    original = file.read_bytes()
    other_original = other.read_bytes()
    assert original != other_original
    file.write_bytes(b'RECEIPT_DURABLE SUCCESS\n')
    assert store.classify_reservation(reservation, claim['nonce'], raw) == 'UNCERTAIN'
    assert store.classify_reservation(reservation, crashed['nonce'], crash_raw) == 'UNCERTAIN'
    assert other.read_bytes() == other_original, 'unrelated reservation was modified'
    file.write_bytes(original)
    assert store.classify_reservation(reservation, claim['nonce'], raw) == 'RESERVED_UNTRUSTED'
    assert other.read_bytes() == other_original

print('GE04 SUP-06 single-use claim reservation PASS: race, replay, nonce collision, crash and tamper fail closed')
