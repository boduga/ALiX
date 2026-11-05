#!/usr/bin/env python3
"""GE-04 privileged endpoint hijack and explicit recovery regression.

Uses only inert fixture messages. Distinct UID 65534 must not unlink,
replace, bind under, or relax root-owned endpoint directory.
"""
import importlib.util
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile

if sys.platform != 'linux' or os.geteuid() != 0:
    raise SystemExit('GE04 endpoint recovery test requires Linux root')

base = Path(__file__).resolve().parent

def load(name):
    spec = importlib.util.spec_from_file_location(
        'ge04_endpoint_' + name.replace('-', '_'), base / (name + '.py'))
    obj = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj

authority = load('sup25-atomic-authority-fixture')
keys = load('fixture-credential-provisioning')

PROBE = """
import os, pathlib, socket, sys
public, private = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
endpoint = public / 'inert-request.sock'
assert os.geteuid() == 65534 and os.getegid() == 65534
def bind_hijack():
    with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as sock:
        sock.bind(str(public / 'hijack.sock'))
actions = [
    lambda: endpoint.unlink(),
    lambda: endpoint.chmod(0o777),
    lambda: public.chmod(0o777),
    bind_hijack,
    lambda: (private / 'state.json').write_text('forged'),
]
for action in actions:
    try:
        action()
    except PermissionError:
        continue
    raise AssertionError('untrusted endpoint or state hijack succeeded')
print('GE04_UNTRUSTED_HIJACK_DENIED', flush=True)
"""

def drop():
    os.setgroups([])
    os.setgid(65534)
    os.setuid(65534)

def probe(public, private):
    result = subprocess.run(
        [sys.executable, '-B', '-c', PROBE, str(public), str(private)],
        preexec_fn=drop, close_fds=True, pass_fds=(),
        capture_output=True, text=True, timeout=8)
    assert result.returncode == 0, (result.stdout, result.stderr)
    assert result.stdout.strip() == 'GE04_UNTRUSTED_HIJACK_DENIED'

def launch(private, public):
    return subprocess.Popen(
        [sys.executable, '-B', str(base / 'isolated-uid-supervisor-fixture.py'),
         str(private), str(public), str(os.getpid()), '0'],
        close_fds=True, pass_fds=(),
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)

def finish(child, expect_ok):
    try:
        exitcode = child.wait(timeout=9)
        assert (exitcode == 0) is expect_ok, (exitcode, child.stderr.read())
    finally:
        if child.poll() is None:
            child.kill()
            child.wait(timeout=5)
        child.stdout.close()
        child.stderr.close()

with tempfile.TemporaryDirectory(prefix='ge04-endpoint-hold-') as name:
    root = Path(name)
    root.chmod(0o711)
    private = root / 'private'
    private.mkdir(mode=0o700)
    public = root / 'public'
    public.mkdir(mode=0o711)
    keys.install_fixture_key(private)
    authority.initialize(private, revision=7, lease='fixture-lease',
                         expiry=1000, approval='fixture-approval')
    endpoint = public / 'inert-request.sock'

    # Existing socket is not unlinked or silently replaced at bootstrap.
    with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as stale:
        stale.bind(str(endpoint))
    original = endpoint.lstat()
    probe(public, private)
    first = launch(private, public)
    try:
        finish(first, False)
    finally:
        assert endpoint.lstat().st_ino == original.st_ino
    assert authority.inspect(private)['consumed'] == []

    # Only privileged recovery removes stale object and restarts fixture.
    endpoint.unlink()
    live = launch(private, public)
    try:
        assert live.stdout.readline().strip() == 'GE04_ISOLATED_SUPERVISOR_READY'
        probe(public, private)
        with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as sender:
            sender.sendto(b'GE04_ISOLATED_INERT_REQUEST', str(endpoint))
        assert live.stdout.readline().strip() == 'GE04_ISOLATED_INERT_OBSERVATION_UNVERIFIED'
        finish(live, True)
    finally:
        if live.poll() is None:
            live.kill()
            live.wait(timeout=5)
        assert authority.inspect(private)['consumed'] == ['isolated-inert-attempt']

    # Orphaned endpoint remains; untrusted actor cannot reset it for replay.
    probe(public, private)
    stale_after = endpoint.lstat()
    retry = launch(private, public)
    finish(retry, False)
    assert endpoint.lstat().st_ino == stale_after.st_ino
    assert authority.inspect(private)['consumed'] == ['isolated-inert-attempt']

print('GE04 isolated endpoint recovery PASS: untrusted hijack denied; stale startup refused; privileged manual recovery only')
