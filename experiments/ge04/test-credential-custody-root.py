#!/usr/bin/env python3
"""SUP-19: privileged, inert credential custody across fresh process exec.

Tests filesystem access and descriptor hygiene, not production role identity,
request authorization, or resistance to a malicious root coordinator.
"""
import hashlib
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile

if sys.platform != 'linux' or os.geteuid() != 0:
    raise SystemExit('GE04 SUP-19 requires root on Linux')

spec = importlib.util.spec_from_file_location(
    'sup19_provision', Path(__file__).with_name('fixture-credential-provisioning.py'))
provision = importlib.util.module_from_spec(spec)
spec.loader.exec_module(provision)

# Fresh exec has no access to Python objects held by the parent. A privileged
# restart may independently reopen the protected key; the dropped-UID child
# must fail to read it and must not inherit a credential descriptor.
CHILD = """
import hashlib, os, pathlib, sys
directory = pathlib.Path(sys.argv[1])
mode = sys.argv[2]
key = directory / 'coordinator.fixture.key'
fd_paths = []
for name in os.listdir('/proc/self/fd'):
    try:
        fd_paths.append(os.readlink('/proc/self/fd/' + name))
    except OSError:
        pass
assert str(key) not in fd_paths, 'credential FD inherited by child'
if mode == 'untrusted':
    assert os.geteuid() == 65534 and os.getegid() == 65534
    try:
        key.read_bytes()
    except PermissionError:
        print('UNTRUSTED_DENIED')
    else:
        raise AssertionError('distinct UID read protected credential')
elif mode == 'trusted':
    assert os.geteuid() == 0
    data = key.read_bytes()
    assert len(data) == 32
    print('TRUSTED_DIGEST:' + hashlib.sha256(data).hexdigest())
else:
    raise AssertionError('invalid fixture mode')
"""


def drop_uid():
    os.setgroups([])
    os.setgid(65534)
    os.setuid(65534)


def run_child(directory, mode, drop=False):
    result = subprocess.run(
        [sys.executable, '-B', '-c', CHILD, str(directory), mode],
        close_fds=True, pass_fds=(), preexec_fn=drop_uid if drop else None,
        capture_output=True, text=True, timeout=8)
    assert result.returncode == 0, (mode, result.stdout, result.stderr)
    return result.stdout.strip()


with tempfile.TemporaryDirectory(prefix='ge04-sup19-') as name:
    base = Path(name)
    base.chmod(0o711)
    protected = base / 'custody'
    protected.mkdir(mode=0o700)
    assert provision.install_fixture_key(protected) == 'KEY_FIXTURE_INSTALLED_UNTRUSTED'
    secret = provision.read_fixture_key(protected, 0)
    expected = hashlib.sha256(secret).hexdigest()
    # Credential may be reopened after a fresh trusted exec, but the test
    # never sends the credential bytes or a credential FD to the child.
    assert run_child(protected, 'trusted') == 'TRUSTED_DIGEST:' + expected
    assert run_child(protected, 'untrusted', drop=True) == 'UNTRUSTED_DENIED'
    # Restart again after the first trusted process has exited.
    assert run_child(protected, 'trusted') == 'TRUSTED_DIGEST:' + expected
    assert run_child(protected, 'untrusted', drop=True) == 'UNTRUSTED_DENIED'
    # Revocation by removing this fixture file prevents future trusted opens;
    # this does not erase previously copied secrets from another process.
    (protected / provision.SECRET_NAME).unlink()
    result = subprocess.run(
        [sys.executable, '-B', '-c', CHILD, str(protected), 'trusted'],
        close_fds=True, pass_fds=(), capture_output=True, text=True, timeout=8)
    assert result.returncode != 0 and 'FileNotFoundError' in result.stderr

print('GE04 SUP-19 custody fixture PASS: trusted restart reopen; distinct UID denied; no inherited key FD; removed key fails closed')
