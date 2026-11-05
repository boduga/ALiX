#!/usr/bin/env python3
"""Linux-root-only GE-04 composed fixed native lifecycle regression."""
import importlib.util
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
        pin = signed.provision(private, public)
        return private, public, owned, pin

    def run(case, checkpoint=None):
        private, public, owned, pin = case
        return composed.run_fixed_fixture(
            private, public, owned, pin, binary, now_ms=1,
            crash_checkpoint=checkpoint)

    good = setup('normal')
    assert composed.recover_read_only(good[0], good[2], good[1], good[3]) == UNKNOWN
    assert run(good) == 'GE04_COMPOSED_FIXTURE_SETTLED_UNVERIFIED'
    assert composed.recover_read_only(good[0], good[2], good[1], good[3]) == MATCH
    assert auth.inspect(good[0])['consumed'] == [observed.ATTEMPT]
    try:
        run(good)
    except PermissionError:
        pass
    else:
        raise AssertionError('repeat attempt accepted')
    assert (good[2] / observed.LEAF).read_bytes() == observed.BODY
    (good[2] / observed.LEAF).write_bytes(b'TAMPERED')
    assert composed.recover_read_only(good[0], good[2], good[1], good[3]) == UNKNOWN

    # A valid signed fixture is not sufficient when protected lifecycle
    # sequence is truncated, duplicated, or its request binding changes.
    chain = setup('journal-tamper')
    assert run(chain) == 'GE04_COMPOSED_FIXTURE_SETTLED_UNVERIFIED'
    assert composed.recover_read_only(chain[0], chain[2], chain[1], chain[3]) == MATCH
    record = chain[0] / 'ge04-lifecycle-2.json'
    raw = record.read_bytes()
    record.write_bytes(raw.replace(b'OBSERVED', b'PREPARED'))
    assert composed.recover_read_only(chain[0], chain[2], chain[1], chain[3]) == UNKNOWN
    record.write_bytes(raw)
    assert composed.recover_read_only(chain[0], chain[2], chain[1], chain[3]) == MATCH
    (chain[0] / 'ge04-lifecycle-3.json').unlink()
    assert composed.recover_read_only(chain[0], chain[2], chain[1], chain[3]) == UNKNOWN

    expired = setup('expired')
    try:
        composed.run_fixed_fixture(*expired[:3], expired[3], binary, now_ms=1000)
    except PermissionError:
        pass
    else:
        raise AssertionError('expired admission accepted')
    assert auth.inspect(expired[0])['approvalState'] == 'approved'
    assert not (expired[2] / observed.LEAF).exists()

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
        expected = MATCH if checkpoint == 'after_signature' else UNKNOWN
        assert composed.recover_read_only(case[0], case[2], case[1], case[3]) == expected, checkpoint
        try:
            run(case)
        except PermissionError:
            pass
        else:
            raise AssertionError('replayed crashed attempt: ' + checkpoint)
        if checkpoint == 'after_prepare':
            assert not (case[2] / observed.LEAF).exists()
        if checkpoint in ('after_native', 'after_observation',
                          'after_settlement', 'after_signature'):
            assert (case[2] / observed.LEAF).read_bytes() == observed.BODY

print('GE04 composed fixture PASS: fixed native sequence, crash quarantine, denial and read-only recovery; HOLD')
