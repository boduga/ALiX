#!/usr/bin/env python3
"""SUP-25 deterministic concurrent inert approval/lease/revocation tests."""
import importlib.util
import multiprocessing as mp
import os
from pathlib import Path
import tempfile
import time

spec = importlib.util.spec_from_file_location(
    'sup25_atomic', Path(__file__).with_name('sup25-atomic-authority-fixture.py'))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


def denied(fn):
    try:
        fn()
    except PermissionError:
        return
    raise AssertionError('inert authorization did not fail closed')


def run(directory, attempt_id, entered=None, resume=None, crash=False, expect_denial=False):
    if expect_denial:
        denied(lambda: gate.attempt(directory, attempt_id=attempt_id,
                                   approval='approval-1', lease='lease-1',
                                   revision=7, now_ms=100))
        return
    gate.attempt(directory, attempt_id=attempt_id, approval='approval-1',
                 lease='lease-1', revision=7, now_ms=100,
                 entered=entered, resume=resume, crash=crash)


def revoke(directory, out):
    out.put(gate.revoke(directory, 8))


def root_of(root, name):
    directory = root / name
    directory.mkdir(mode=0o700)
    gate.initialize(directory, revision=7, lease='lease-1',
                    expiry=1000, approval='approval-1')
    return directory


with tempfile.TemporaryDirectory(prefix='ge04-sup25-') as name:
    root = Path(name)
    root.chmod(0o700)

    # Wrong approval, policy, lease and expiry cannot consume the attempt.
    negative = root_of(root, 'negative')
    for approval, lease, revision, now in [
        ('approval-2', 'lease-1', 7, 100),
        ('approval-1', 'lease-2', 7, 100),
        ('approval-1', 'lease-1', 8, 100),
        ('approval-1', 'lease-1', 7, 1000),
    ]:
        denied(lambda: gate.attempt(
            negative, attempt_id='attempt-1', approval=approval,
            lease=lease, revision=revision, now_ms=now))
    assert gate.inspect(negative)['consumed'] == []
    assert gate.attempt(negative, attempt_id='attempt-1',
                        approval='approval-1', lease='lease-1',
                        revision=7, now_ms=100) == 'SUP25_INERT_OUTCOME_UNVERIFIED'
    denied(lambda: run(negative, 'attempt-1'))
    assert gate.inspect(negative)['consumed'] == ['attempt-1']

    # Revocation obtains the same lock: if it arrives before admission,
    # no attempt is consumed; if admission wins, revoke cannot overtake it.
    before = root_of(root, 'revoke-first')
    assert gate.revoke(before, 8) == 'SUP25_REVOKED_UNVERIFIED'
    denied(lambda: run(before, 'attempt-1'))
    assert gate.inspect(before)['consumed'] == []

    during = root_of(root, 'attempt-first')
    entered, resume, result = mp.Event(), mp.Event(), mp.Queue()
    worker = mp.Process(target=run, args=(during, 'attempt-1', entered, resume))
    worker.start()
    assert entered.wait(5), 'attempt failed before entering serialized region'
    revoker = mp.Process(target=revoke, args=(during, result))
    revoker.start()
    time.sleep(0.2)
    assert revoker.is_alive(), 'revocation overtook in-flight inert transition'
    resume.set()
    worker.join(10)
    revoker.join(10)
    assert worker.exitcode == revoker.exitcode == 0
    assert result.get(timeout=3) == 'SUP25_REVOKED_UNVERIFIED'
    state = gate.inspect(during)
    assert state['inFlight'] is None and state['revoked']
    denied(lambda: run(during, 'attempt-2'))

    # Crash after durable prepare must never permit the old attempt, a
    # different attempt, or revision bump to imply a safe retry.
    crash_root = root_of(root, 'crash')
    crash_worker = mp.Process(target=run, args=(crash_root, 'attempt-1', None, None, True))
    crash_worker.start()
    crash_worker.join(10)
    assert crash_worker.exitcode == 88, crash_worker.exitcode
    state = gate.inspect(crash_root)
    assert state['inFlight'] == 'attempt-1'
    assert state['consumed'] == ['attempt-1']
    denied(lambda: run(crash_root, 'attempt-1'))
    denied(lambda: run(crash_root, 'attempt-2'))
    assert gate.revoke(crash_root, 8) == 'SUP25_REVOKED_UNVERIFIED'
    assert gate.inspect(crash_root)['inFlight'] == 'attempt-1'

    # Two independent processes racing the same attempt cannot both enter.
    parallel = root_of(root, 'parallel')
    started, resume = mp.Event(), mp.Event()
    one = mp.Process(target=run, args=(parallel, 'attempt-1', started, resume))
    one.start()
    assert started.wait(5)
    two = mp.Process(target=run, args=(parallel, 'attempt-1', None, None, False, True))
    two.start()
    time.sleep(0.1)
    assert two.is_alive(), 'second contender must wait on lock'
    resume.set()
    one.join(10)
    two.join(10)
    assert one.exitcode == 0
    assert two.exitcode == 0, 'second contender did not confirm denial'
    assert gate.inspect(parallel)['consumed'] == ['attempt-1']
    assert gate.inspect(parallel)['approvalState'] == 'consumed'

print('GE04 SUP-25 atomic inert authority PASS: approval/lease/policy/expiry denied; revoke serialized; replay and crash quarantined')
