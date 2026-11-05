#!/usr/bin/env python3
"""Linux-root-only GE-04 composed fixed native lifecycle regression."""
import importlib.util
import multiprocessing
import time
import os
from pathlib import Path
import subprocess
import sys
import tempfile

if sys.platform != 'linux' or os.geteuid() != 0:
    raise SystemExit('requires isolated Linux root CI fixture')

BASE = Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location(
        'ge04_composed_test_' + name.replace('-', '_'), BASE / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


auth = load('sup25-atomic-authority-fixture')
credential = load('fixture-credential-provisioning')
signed = load('signed-native-observation-fixture')
observed = load('native-effect-observation-fixture')
composed = load('supervisor-composed-lifecycle-fixture')
MATCH = 'GE04_SIGNED_FIXTURE_OBSERVATION_MATCHED_EFFECT_UNVERIFIED'
UNKNOWN = 'UNCERTAIN_NO_REPLAY'

with tempfile.TemporaryDirectory(prefix='ge04-composed-') as name:
    root = Path(name)
    root.chmod(0o700)
    binary = root / 'fixed-inert-native'
    build = subprocess.run(
        ['gcc', '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror',
         str(BASE / 'final-boundary-inert-kernel-create.c'), '-o', str(binary)],
        capture_output=True, text=True, timeout=20)
    assert build.returncode == 0, build.stderr
    binary.chmod(0o700)

    def setup(label):
        private, public, owned = (root / (label + suffix) for suffix in
                                  ('-private', '-public', '-owned'))
        private.mkdir(mode=0o700)
        public.mkdir(mode=0o755)
        owned.mkdir(mode=0o700)
        credential.install_fixture_key(private)
        auth.initialize(private, revision=7, lease='lease', expiry=1000,
                        approval='approval')
        anchor = root / (label + '-anchor')
        anchor.mkdir(mode=0o700)
        pin = signed.provision(private, public)
        return private, public, owned, pin, anchor

    def run(case, checkpoint=None):
        private, public, owned, pin, anchor = case
        return composed.run_fixed_fixture(
            private, public, owned, pin, binary, anchor_dir=anchor, now_ms=1, effect_now_ms=1,
            crash_checkpoint=checkpoint)

    good = setup('normal')
    assert composed.recover_read_only(good[0], good[2], good[1], good[3], anchor_dir=good[4]) == UNKNOWN
    assert run(good) == 'GE04_COMPOSED_FIXTURE_SETTLED_UNVERIFIED'
    assert composed.recover_read_only(good[0], good[2], good[1], good[3], anchor_dir=good[4]) == MATCH
    assert auth.inspect(good[0])['consumed'] == [observed.ATTEMPT]
    try:
        run(good)
    except PermissionError:
        pass
    else:
        raise AssertionError('repeat attempt accepted')
    assert (good[2] / observed.LEAF).read_bytes() == observed.BODY
    (good[2] / observed.LEAF).write_bytes(b'TAMPERED')
    assert composed.recover_read_only(good[0], good[2], good[1], good[3], anchor_dir=good[4]) == UNKNOWN

    # A valid signed fixture is not sufficient when protected lifecycle
    # sequence is truncated, duplicated, or its request binding changes.
    chain = setup('journal-tamper')
    assert run(chain) == 'GE04_COMPOSED_FIXTURE_SETTLED_UNVERIFIED'
    assert composed.recover_read_only(chain[0], chain[2], chain[1], chain[3], anchor_dir=chain[4]) == MATCH
    record = chain[0] / 'ge04-lifecycle-2.json'
    raw = record.read_bytes()
    record.write_bytes(raw.replace(b'OBSERVED', b'PREPARED'))
    assert composed.recover_read_only(chain[0], chain[2], chain[1], chain[3], anchor_dir=chain[4]) == UNKNOWN
    record.write_bytes(raw)
    assert composed.recover_read_only(chain[0], chain[2], chain[1], chain[3], anchor_dir=chain[4]) == MATCH
    (chain[0] / 'ge04-lifecycle-3.json').unlink()
    assert composed.recover_read_only(chain[0], chain[2], chain[1], chain[3], anchor_dir=chain[4]) == UNKNOWN

    # Complete locally valid journal bytes cannot be substituted without
    # invalidating the anchor stored in the separate test-only directory.
    whole = setup('full-chain-rewrite')
    assert run(whole) == 'GE04_COMPOSED_FIXTURE_SETTLED_UNVERIFIED'
    assert composed.recover_read_only(
        whole[0], whole[2], whole[1], whole[3], anchor_dir=whole[4]) == MATCH
    # Re-encode every record as valid JSON with different whitespace, and
    # rebuild its correct previousDigest link, maintaining a valid chain.
    import hashlib
    import json
    previous = '0' * 64
    for index in range(1, 5):
        path = whole[0] / ('ge04-lifecycle-' + str(index) + '.json')
        obj = json.loads(path.read_bytes())
        obj['previousDigest'] = previous
        raw = json.dumps(obj, sort_keys=True, indent=1).encode() + b'\n'
        path.write_bytes(raw)
        previous = hashlib.sha256(raw).hexdigest()
    journal = load('supervisor-lifecycle-journal')
    fd = auth._directory(whole[0])
    try:
        lock = auth._lock(fd)
        try:
            pinned = os.open(whole[2], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                request_digest = journal.fingerprint(journal.fixed_request(auth._load(fd), pinned))
                assert journal.classify(fd, request_digest) == 'CHAIN_COMPLETE_UNVERIFIED'
            finally:
                os.close(pinned)
        finally:
            os.close(lock)
    finally:
        os.close(fd)
    assert composed.recover_read_only(
        whole[0], whole[2], whole[1], whole[3], anchor_dir=whole[4]) == UNKNOWN

    # The trusted anchor is absent/invalid: never treat signed fixture as
    # terminal proof, even if the journal and effect still match.
    missing = setup('missing-anchor')
    assert run(missing) == 'GE04_COMPOSED_FIXTURE_SETTLED_UNVERIFIED'
    (missing[4] / 'lifecycle-anchor.json').unlink()
    assert composed.recover_read_only(
        missing[0], missing[2], missing[1], missing[3], anchor_dir=missing[4]) == UNKNOWN

    expired = setup('expired')
    try:
        composed.run_fixed_fixture(*expired[:3], expired[3], binary, anchor_dir=expired[4], now_ms=1000, effect_now_ms=1000)
    except PermissionError:
        pass
    else:
        raise AssertionError('expired admission accepted')
    assert auth.inspect(expired[0])['approvalState'] == 'approved'
    assert not (expired[2] / observed.LEAF).exists()

    # PREPARED is durable before a second (fixture-controlled) clock
    # observation. Expiry blocks native effect but cannot restore approval.
    crossed = setup('expires-between-admission-and-effect')
    try:
        composed.run_fixed_fixture(
            crossed[0], crossed[1], crossed[2], crossed[3], binary,
            anchor_dir=crossed[4], now_ms=1, effect_now_ms=1000)
    except PermissionError:
        pass
    else:
        raise AssertionError('late expiry permitted native effect')
    assert auth.inspect(crossed[0])['consumed'] == [observed.ATTEMPT]
    assert auth.inspect(crossed[0])['inFlight'] == observed.ATTEMPT
    assert not (crossed[2] / observed.LEAF).exists()
    assert composed.recover_read_only(
        crossed[0], crossed[2], crossed[1], crossed[3], anchor_dir=crossed[4]) == UNKNOWN

    # Use independent processes (not same-process flock, not a sleep-only
    # timing assertion): revocation must wait for the held fixture lock.
    racing = setup('revocation-after-prepared')
    entered = multiprocessing.Event()
    resume = multiprocessing.Event()
    revoked = multiprocessing.Event()
    ctx = multiprocessing.get_context('fork')
    def effect_actor():
        try:
            composed.run_fixed_fixture(
                racing[0], racing[1], racing[2], racing[3], binary,
                anchor_dir=racing[4], now_ms=1, effect_now_ms=1,
                before_native_entered=entered, before_native_resume=resume)
        except BaseException:
            os._exit(91)

    def revoker_actor():
        try:
            auth.revoke(racing[0], 8)
            revoked.set()
        except BaseException:
            os._exit(92)

    worker = ctx.Process(target=effect_actor)
    revoker = ctx.Process(target=revoker_actor)
    worker.start()
    try:
        assert entered.wait(8), 'effect did not reach prepared boundary'
        revoker.start()
        # The revoker has no ability to update the record while the worker
        # owns the lock. This check alone is timing-dependent; final state is
        # also checked after both child processes have exited.
        assert not revoked.wait(0.15), 'revocation bypassed held fixture lock'
    finally:
        resume.set()
        worker.join(10)
        if worker.is_alive():
            worker.terminate()
            worker.join()
        if revoker.pid is not None:
            revoker.join(10)
            if revoker.is_alive():
                revoker.terminate()
                revoker.join()
    assert worker.exitcode == 0, worker.exitcode
    assert revoker.exitcode == 0 and revoked.is_set(), 'revocation did not serialize'
    assert auth.inspect(racing[0])['revoked'] is True
    assert auth.inspect(racing[0])['consumed'] == [observed.ATTEMPT]
    assert (racing[2] / observed.LEAF).read_bytes() == observed.BODY
    # Revocation changes authority, so read-only recovery remains uncertain.
    assert composed.recover_read_only(
        racing[0], racing[2], racing[1], racing[3], anchor_dir=racing[4]) == UNKNOWN

    # Revocation linearized before the request: no approval consumption.
    revoked_first = setup('revocation-before-admission')
    auth.revoke(revoked_first[0], 8)
    try:
        run(revoked_first)
    except PermissionError:
        pass
    else:
        raise AssertionError('revoked request accepted')
    assert auth.inspect(revoked_first[0])['consumed'] == []
    assert not (revoked_first[2] / observed.LEAF).exists()

    for checkpoint in sorted(composed.CHECKPOINTS):
        case = setup(checkpoint)
        pid = os.fork()
        if pid == 0:
            try:
                run(case, checkpoint)
            except BaseException:
                os._exit(91)
            os._exit(92)
        _, status = os.waitpid(pid, 0)
        assert os.WIFEXITED(status) and os.WEXITSTATUS(status) == 88, checkpoint
        state = auth.inspect(case[0])
        assert state['consumed'] == [observed.ATTEMPT], checkpoint
        expected = MATCH if checkpoint == 'after_anchor' else UNKNOWN
        assert composed.recover_read_only(case[0], case[2], case[1], case[3], anchor_dir=case[4]) == expected, checkpoint
        try:
            run(case)
        except PermissionError:
            pass
        else:
            raise AssertionError('replayed crashed attempt: ' + checkpoint)
        if checkpoint == 'after_prepare':
            assert not (case[2] / observed.LEAF).exists()
        if checkpoint in ('after_native', 'after_observation',
                          'after_settlement', 'after_signature', 'after_anchor'):
            assert (case[2] / observed.LEAF).read_bytes() == observed.BODY

print('GE04 composed fixture PASS: fixed native sequence, crash quarantine, denial and read-only recovery; HOLD')
