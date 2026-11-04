#!/usr/bin/env python3
"""SUP-07 cooperative fence fixture: independent processes and crash uncertainty."""
import importlib.util
import multiprocessing as mp
from pathlib import Path
import tempfile
import time

spec = importlib.util.spec_from_file_location('sup07', Path(__file__).with_name('cooperative-revocation-fence.py'))
fence = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fence)

def mutate(path, entered=None, resume=None, crash=False):
    try:
        fence.fixture_mutation(path, 'attempt-one', 'lease-one', 7, 100, entered, resume, crash)
    except BaseException:
        raise

def revoker(path, completion):
    result = fence.revoke(path, 8)
    completion.put(result)

with tempfile.TemporaryDirectory(prefix='ge04-sup07-') as tmp:
    root = Path(tmp)
    root.chmod(0o700)
    # Revocation wins before admission -> no marker.
    first = root / 'revocation-first'
    first.mkdir(mode=0o700)
    fence.initialize(first, 'lease-one', 7, 1000)
    assert fence.revoke(first, 8) == 'REVOKED'
    try: fence.fixture_mutation(first, 'attempt-one', 'lease-one', 7, 100)
    except PermissionError: pass
    else: raise AssertionError('post-revocation admission succeeded')
    assert not list(first.glob('marker-*'))
    assert fence.inspect(first)['policyRevision'] == 8

    # Mutation begins before revocation: revoker must block on same lock.
    second = root / 'mutation-first'
    second.mkdir(mode=0o700)
    fence.initialize(second, 'lease-one', 7, 1000)
    entered, resume, result = mp.Event(), mp.Event(), mp.Queue()
    worker = mp.Process(target=mutate, args=(second, entered, resume))
    worker.start()
    assert entered.wait(5), 'mutation did not establish locked in-flight state'
    rev = mp.Process(target=revoker, args=(second, result))
    rev.start()
    time.sleep(0.2)
    assert rev.is_alive(), 'revocation did not wait for mutation lock'
    assert result.empty(), 'revocation finished during in-flight mutation'
    resume.set()
    worker.join(10); rev.join(10)
    assert worker.exitcode == rev.exitcode == 0, (worker.exitcode, rev.exitcode)
    assert result.get(timeout=3) == 'REVOKED'
    assert len(list(second.glob('marker-*'))) == 1
    assert fence.inspect(second)['inFlight'] is None
    try: fence.fixture_mutation(second, 'attempt-two', 'lease-one', 7, 100)
    except PermissionError: pass
    else: raise AssertionError('replay after revocation succeeded')

    # Crash after durable prepare: lock released by OS, revoker quarantines.
    third = root / 'crash'
    third.mkdir(mode=0o700)
    fence.initialize(third, 'lease-one', 7, 1000)
    dead = mp.Process(target=mutate, args=(third, None, None, True))
    dead.start(); dead.join(10)
    assert dead.exitcode == 88, dead.exitcode
    assert fence.inspect(third)['inFlight'] == 'attempt-one'
    assert fence.revoke(third, 8) == 'UNCERTAIN'
    assert fence.inspect(third)['leaseState'] == 'uncertain'
    try: fence.fixture_mutation(third, 'attempt-two', 'lease-one', 8, 100)
    except PermissionError: pass
    else: raise AssertionError('uncertain state replayed')

    # Expiry and policy mismatch are checked under lock, not before it.
    fourth = root / 'expired'
    fourth.mkdir(mode=0o700)
    fence.initialize(fourth, 'lease-one', 7, 1000)
    for revision, now in [(7, 1000), (8, 100)]:
        try: fence.fixture_mutation(fourth, 'attempt-one', 'lease-one', revision, now)
        except PermissionError: pass
        else: raise AssertionError('expired or stale revision permitted')
    assert not list(fourth.glob('marker-*'))
print('GE04 SUP-07 cooperative fence PASS: revocation order, concurrent lock, expiry and crash quarantine')
