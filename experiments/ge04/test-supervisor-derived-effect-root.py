#!/usr/bin/env python3
"""Root-only GE-04 supervisor-derived evidence + crash regression.

One fixed openat2 test effect. Never a production mutation path.
"""
import hashlib
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile

if sys.platform != 'linux' or os.geteuid() != 0:
    raise SystemExit('GE04 supervisor-derived evidence requires Linux root')

base = Path(__file__).resolve().parent
def load(name):
    spec = importlib.util.spec_from_file_location(
        'ge04_test_' + name.replace('-', '_'), base / (name + '.py'))
    obj = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj

auth = load('sup25-atomic-authority-fixture')
fixture_key = load('fixture-credential-provisioning')
observed = load('native-effect-observation-fixture')
signed = load('signed-native-observation-fixture')
derived = load('supervisor-derived-effect-fixture')
MATCH = 'GE04_SIGNED_FIXTURE_OBSERVATION_MATCHED_EFFECT_UNVERIFIED'
UNKNOWN = 'UNCERTAIN_NO_REPLAY'


def create(root, label):
    private = root / (label + '-private')
    public = root / (label + '-public')
    owned = root / (label + '-owned')
    private.mkdir(mode=0o700)
    public.mkdir(mode=0o755)
    owned.mkdir(mode=0o700)
    fixture_key.install_fixture_key(private)
    auth.initialize(private, revision=7, lease='lease', expiry=1000, approval='approval')
    key_pin = signed.provision(private, public)
    return private, public, owned, key_pin


def mutate(binary, private, owned, phase):
    fd = auth._directory(private)
    try:
        lock = auth._lock(fd)
        try:
            state = auth._load(fd)
            assert state['approvalState'] == 'approved'
            state['approvalState'] = 'consumed'
            state['inFlight'] = observed.ATTEMPT
            state['consumed'] = [observed.ATTEMPT]
            auth._save(fd, state)
            if phase == 'prepared':
                return
            pinned = os.open(owned, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                result = subprocess.run(
                    [str(binary), 'GE04-INERT-FIXTURE-V1', str(pinned)],
                    env={'PATH': '/usr/bin:/bin'}, pass_fds=(pinned,), close_fds=True,
                    capture_output=True, text=True, timeout=8)
                assert result.returncode == 0 and result.stdout.strip() == observed.MARKER, (
                    result.returncode, result.stdout, result.stderr)
                if phase == 'effect-without-observation':
                    return
                assert observed.persist_locked(fd, private, pinned, state,
                                               result.stdout.strip()).endswith('_UNVERIFIED')
            finally:
                os.close(pinned)
            if phase == 'observation-before-settle':
                return
            state['inFlight'] = None
            auth._save(fd, state)
        finally:
            os.close(lock)
    finally:
        os.close(fd)


def inspect(private, public, owned, pin):
    return derived.recover_read_only(private, owned, public, pin)


def publish_case(private, public, owned, pin):
    return derived.publish(private, owned, public, pin)


with tempfile.TemporaryDirectory(prefix='ge04-supervisor-derived-') as name:
    root = Path(name)
    root.chmod(0o700)
    binary = root / 'fixed-inert-native'
    built = subprocess.run(
        ['gcc', '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror',
         str(base / 'final-boundary-inert-kernel-create.c'), '-o', str(binary)],
        capture_output=True, text=True, timeout=20)
    assert built.returncode == 0, built.stderr
    binary.chmod(0o700)

    normal = create(root, 'settled')
    private, public, owned, pin = normal
    assert inspect(*normal) == UNKNOWN
    try:
        publish_case(*normal)
    except PermissionError:
        pass
    else:
        raise AssertionError('signed before native effect')
    mutate(binary, private, owned, 'settled')
    assert inspect(*normal) == UNKNOWN  # durable observation, but no signature yet
    assert publish_case(*normal).endswith('_UNVERIFIED')
    assert inspect(*normal) == MATCH
    assert auth.inspect(private)['consumed'] == [observed.ATTEMPT]
    try:
        publish_case(*normal)
    except FileExistsError:
        pass
    else:
        raise AssertionError('signature replay allowed')
    signed_data = (public / signed.RECEIPT).read_bytes()
    (public / signed.RECEIPT).write_bytes(signed_data.replace(b'NATIVE_FIXTURE_OBSERVED_UNVERIFIED',
                                                              b'FORGED_FIXTURE_OBSERVED_UNVERIFIED'))
    assert inspect(*normal) == UNKNOWN
    (public / signed.RECEIPT).write_bytes(signed_data)
    assert inspect(*normal) == MATCH
    (owned / observed.LEAF).write_bytes(b'TAMPERED')
    assert inspect(*normal) == UNKNOWN

    # Missing kernel marker, missing durable observation, or unsettled state:
    # none can be signed, even though actual native file may exist.
    for phase in ('prepared', 'effect-without-observation', 'observation-before-settle'):
        case = create(root, phase)
        mutate(binary, case[0], case[2], phase)
        assert inspect(*case) == UNKNOWN, phase
        try:
            publish_case(*case)
        except PermissionError:
            pass
        else:
            raise AssertionError('unsettled/unsigned effect was signed: ' + phase)
        assert auth.inspect(case[0])['consumed'] == [observed.ATTEMPT]

    # Separate process SIGKILL-equivalent abrupt exit after durable native
    # observation but before authority settlement and signing.
    crash = create(root, 'crash-after-observation')
    child = os.fork()
    if child == 0:
        try:
            mutate(binary, crash[0], crash[2], 'observation-before-settle')
        except BaseException:
            os._exit(91)
        os._exit(88)
    _, status = os.waitpid(child, 0)
    assert os.WIFEXITED(status) and os.WEXITSTATUS(status) == 88
    assert inspect(*crash) == UNKNOWN
    assert auth.inspect(crash[0])['inFlight'] == observed.ATTEMPT
    assert (crash[2] / observed.LEAF).read_bytes() == observed.BODY

print('GE04 supervisor-derived signed observation PASS: actual pinned effect; sealed settlement gate; crash quarantine; tamper/replay denied')
