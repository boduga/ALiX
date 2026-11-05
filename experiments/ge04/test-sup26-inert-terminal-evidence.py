#!/usr/bin/env python3
"""SUP-26 fail-closed recovery: inert record, crash, tamper, duplicate."""
import importlib.util
import multiprocessing as mp
from pathlib import Path
import tempfile


def load(name):
    spec = importlib.util.spec_from_file_location('sup26test_' + name.replace('-', '_'),
        Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

gate = load('sup25-atomic-authority-fixture')
record = load('sup26-inert-terminal-evidence')
keys = load('fixture-credential-provisioning')


def denied(fn):
    try:
        fn()
    except (PermissionError, FileExistsError):
        return
    raise AssertionError('duplicate or unsafe observation accepted')


def root_of(base, name):
    root = base / name
    root.mkdir(mode=0o700)
    assert keys.install_fixture_key(root) == 'KEY_FIXTURE_INSTALLED_UNTRUSTED'
    gate.initialize(root, revision=7, lease='lease', expiry=1000, approval='approval')
    return root


def attempt(root, crash=False):
    gate.attempt(root, attempt_id='attempt', approval='approval', lease='lease',
                 revision=7, now_ms=100, crash=crash)


with tempfile.TemporaryDirectory(prefix='ge04-sup26-') as name:
    base = Path(name)
    base.chmod(0o700)
    complete = root_of(base, 'complete')
    assert record.classify(complete, 'attempt') == 'UNCERTAIN'
    denied(lambda: record.persist_observation(complete, 'attempt'))
    assert record.classify(complete, 'attempt') == 'UNCERTAIN'

    assert gate.attempt(complete, attempt_id='attempt', approval='approval',
                        lease='lease', revision=7, now_ms=100) == 'SUP25_INERT_OUTCOME_UNVERIFIED'
    assert record.classify(complete, 'attempt') == 'UNCERTAIN'
    assert record.persist_observation(complete, 'attempt') == 'SUP26_INERT_RECORD_PERSISTED_UNVERIFIED'
    assert record.classify(complete, 'attempt') == 'INERT_RECORD_MATCHED_EFFECT_UNVERIFIED'
    denied(lambda: record.persist_observation(complete, 'attempt'))
    assert record.classify(complete, 'wrong-attempt') == 'UNCERTAIN'

    # Modify a durable terminal record; a forged/torn observation fails closed.
    receipt = complete / record.RECEIPT
    raw = receipt.read_bytes()
    receipt.write_bytes(raw.replace(b'INERT_TRANSITION_OBSERVED_UNVERIFIED', b'INERT_TRANSITION_FORGED_UNVERIFIED'))
    assert record.classify(complete, 'attempt') == 'UNCERTAIN'
    receipt.write_bytes(raw)
    assert record.classify(complete, 'attempt') == 'INERT_RECORD_MATCHED_EFFECT_UNVERIFIED'

    # An interrupted operation never receives a valid observation or retry.
    interrupted = root_of(base, 'interrupted')
    child = mp.Process(target=attempt, args=(interrupted, True))
    child.start()
    child.join(10)
    assert child.exitcode == 88, child.exitcode
    assert gate.inspect(interrupted)['inFlight'] == 'attempt'
    assert record.classify(interrupted, 'attempt') == 'UNCERTAIN'
    denied(lambda: record.persist_observation(interrupted, 'attempt'))
    denied(lambda: attempt(interrupted))
    assert not (interrupted / record.RECEIPT).exists()
    assert gate.revoke(interrupted, 8) == 'SUP25_REVOKED_UNVERIFIED'
    assert record.classify(interrupted, 'attempt') == 'UNCERTAIN'

    # Reboot/restart simulation: reread freshly opened persisted state, never
    # derive success from a missing record or clear in-flight on recovery.
    missing = root_of(base, 'no-receipt')
    attempt(missing)
    assert record.classify(missing, 'attempt') == 'UNCERTAIN'

print('GE04 SUP-26 inert terminal evidence PASS: durable marker matched; crash/missing/tampered/replayed evidence uncertain')
