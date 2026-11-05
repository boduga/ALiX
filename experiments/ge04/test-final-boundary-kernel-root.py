#!/usr/bin/env python3
"""GE-04 privileged TEMPORARY real-kernel fixture, NOT production authority.

Runs one fixed openat2 create while a root-owned SUP-25 fixture lock is held.
Demonstrates pinned-directory containment and crash uncertainty; a malicious
root/provisioner can still bypass every part of this experiment.
"""
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

if sys.platform != 'linux' or os.geteuid() != 0:
    raise SystemExit('GE04 final-boundary test requires Linux root')

base = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    'ge04_final_fixture', base / 'sup25-atomic-authority-fixture.py')
auth = importlib.util.module_from_spec(spec)
spec.loader.exec_module(auth)

BODY = b'GE04_INERT_KERNEL_WRITE_NO_PRODUCTION_AUTHORITY\n'
MARKER = 'GE04_NATIVE_FIXTURE_FSYNCED_UNVERIFIED'
LEAF = 'ge04-inert-effect.bin'


def make_root(root, label):
    private = root / (label + '-authority')
    private.mkdir(mode=0o700)
    auth.initialize(private, revision=7, lease='lease', expiry=1000, approval='approval')
    target = root / (label + '-owned')
    target.mkdir(mode=0o700)
    return private, target


def execute_inert(private, pinned, binary, *, lost=False, before_child=None):
    """Lock + fixed fixture authority + real syscall (NO user-supplied operation)."""
    rootfd = auth._directory(private)
    try:
        lock = auth._lock(rootfd)
        try:
            state = auth._load(rootfd)
            if (state['revoked'] or state['policyRevision'] != 7 or
                    state['leaseId'] != 'lease' or state['expiresAtMs'] <= 100 or
                    state['approvalId'] != 'approval' or
                    state['approvalState'] != 'approved' or
                    state['inFlight'] is not None or state['consumed']):
                raise PermissionError('fixture authority was already consumed')
            state['approvalState'] = 'consumed'
            state['inFlight'] = 'fixed-kernel-attempt'
            state['consumed'] = ['fixed-kernel-attempt']
            auth._save(rootfd, state)  # durable PREPARED before any kernel effect

            fd = os.open(pinned, os.O_RDONLY | os.O_DIRECTORY |
                         os.O_NOFOLLOW | os.O_CLOEXEC)
            try:
                if before_child is not None:
                    before_child()
                env = {'PATH': '/usr/bin:/bin'}
                if lost:
                    env['GE04_TEST_LOSE_TERMINAL'] = '1'
                run = subprocess.run([str(binary), 'GE04-INERT-FIXTURE-V1', str(fd)],
                                     env=env, pass_fds=(fd,), close_fds=True,
                                     capture_output=True, text=True, timeout=8)
            finally:
                os.close(fd)
            if run.returncode != 0 or run.stdout.strip() != MARKER:
                return 'GE04_REAL_KERNEL_EFFECT_UNCERTAIN_NO_RETRY'
            state['inFlight'] = None
            auth._save(rootfd, state)
            return 'GE04_REAL_KERNEL_EFFECT_OBSERVED_UNVERIFIED'
        finally:
            os.close(lock)
    finally:
        os.close(rootfd)


def denied(fn):
    try:
        fn()
    except PermissionError:
        return
    raise AssertionError('fixture allowed replay of consumed authority')


with tempfile.TemporaryDirectory(prefix='ge04-real-kernel-inert-') as name:
    root = Path(name)
    root.chmod(0o700)
    binary = root / 'inert-kernel-fixture'
    build = subprocess.run(
        ['gcc', '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror',
         str(base / 'final-boundary-inert-kernel-create.c'), '-o', str(binary)],
        capture_output=True, text=True, timeout=20)
    assert build.returncode == 0, build.stderr
    binary.chmod(0o700)

    private, target = make_root(root, 'normal')
    assert execute_inert(private, target, binary) == 'GE04_REAL_KERNEL_EFFECT_OBSERVED_UNVERIFIED'
    assert (target / LEAF).read_bytes() == BODY
    assert auth.inspect(private)['inFlight'] is None
    denied(lambda: execute_inert(private, target, binary))
    assert len(auth.inspect(private)['consumed']) == 1

    crash_private, crash_target = make_root(root, 'lost-terminal')
    assert execute_inert(crash_private, crash_target, binary, lost=True) == (
        'GE04_REAL_KERNEL_EFFECT_UNCERTAIN_NO_RETRY')
    assert (crash_target / LEAF).read_bytes() == BODY
    assert auth.inspect(crash_private)['inFlight'] == 'fixed-kernel-attempt'
    denied(lambda: execute_inert(crash_private, crash_target, binary))
    assert auth.revoke(crash_private, 8) == 'SUP25_REVOKED_UNVERIFIED'

    # Pin owned directory BEFORE an adversarial pathname swap. Kernel write
    # must land in the original pinned inode, never in the outside sentinel.
    swap_private, swap_target = make_root(root, 'swap')
    outside = root / 'unowned'
    outside.mkdir(mode=0o700)
    sentinel = outside / LEAF
    sentinel.write_text('OUTSIDE_UNCHANGED')
    moved = root / 'renamed-owned'
    def swap():
        swap_target.rename(moved)
        swap_target.symlink_to(outside, target_is_directory=True)
    assert execute_inert(swap_private, swap_target, binary, before_child=swap) == (
        'GE04_REAL_KERNEL_EFFECT_OBSERVED_UNVERIFIED')
    assert (moved / LEAF).read_bytes() == BODY
    assert sentinel.read_text() == 'OUTSIDE_UNCHANGED'
    assert (swap_target / LEAF).read_text() == 'OUTSIDE_UNCHANGED'

    # An untrusted UID cannot directly change the root-only authority state
    # or overwrite the pinned fixture effect.
    probe = subprocess.run(
        [sys.executable, '-B', '-c',
         'import pathlib,sys; p=pathlib.Path(sys.argv[1]); '
         'q=pathlib.Path(sys.argv[2]); '
         'denied=0; '
         '\nfor f in (p,q):\n'
         ' try: f.write_text("forged")\n'
         ' except PermissionError: denied+=1\n'
         'assert denied==2', str(private / 'state.json'), str(target / LEAF)],
        preexec_fn=lambda: (os.setgroups([]), os.setgid(65534), os.setuid(65534)),
        capture_output=True, text=True, timeout=8)
    assert probe.returncode == 0, (probe.stdout, probe.stderr)

print('GE04 pinned kernel create fixture PASS: actual openat2 write under fixture lock; symlink swap contained; terminal loss quarantined; replay denied')
