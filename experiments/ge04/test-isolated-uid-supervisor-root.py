#!/usr/bin/env python3
"""GE-04 cross-UID privileged supervisor boundary adversarial regression."""
import importlib.util
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile

if sys.platform != 'linux' or os.geteuid() != 0:
    raise SystemExit('GE04 isolated UID supervisor test requires root Linux')

base = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    'sup25_isolated', base / 'sup25-atomic-authority-fixture.py')
authority = importlib.util.module_from_spec(spec)
spec.loader.exec_module(authority)
spec = importlib.util.spec_from_file_location(
    'sup15_isolated', base / 'fixture-credential-provisioning.py')
keys = importlib.util.module_from_spec(spec)
spec.loader.exec_module(keys)

UNTRUSTED = """
import os, pathlib, socket, sys
private, public = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
assert os.geteuid() == 65534 and os.getegid() == 65534
targets = [
    lambda: (private / 'coordinator.fixture.key').read_bytes(),
    lambda: (private / 'state.json').read_bytes(),
    lambda: (private / 'state.json').write_text('{"revoked":false}'),
    lambda: (private / 'terminal-observation.json').write_text('forged'),
    lambda: private.chmod(0o777),
]
for probe in targets:
    try:
        probe()
    except PermissionError:
        continue
    raise AssertionError('untrusted coordinator modified protected authority')
print('UNTRUSTED_WRITE_AND_KEY_DENIED', flush=True)
assert sys.stdin.readline().strip() == 'GO'
with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as client:
    client.sendto(b'GE04_ISOLATED_INERT_REQUEST', str(public / 'inert-request.sock'))
print('UNTRUSTED_INERT_SENT', flush=True)
assert sys.stdin.readline().strip() == 'DONE'
"""

def drop_uid():
    os.setgroups([])
    os.setgid(65534)
    os.setuid(65534)


with tempfile.TemporaryDirectory(prefix='ge04-isolated-uid-') as name:
    root = Path(name)
    root.chmod(0o711)
    private = root / 'private-authority'
    private.mkdir(mode=0o700)
    public = root / 'public-channel'
    public.mkdir(mode=0o711)
    assert keys.install_fixture_key(private) == 'KEY_FIXTURE_INSTALLED_UNTRUSTED'
    authority.initialize(private, revision=7, lease='fixture-lease',
                         expiry=1000, approval='fixture-approval')

    coordinator = subprocess.Popen(
        [sys.executable, '-B', '-c', UNTRUSTED, str(private), str(public)],
        preexec_fn=drop_uid, close_fds=True, pass_fds=(),
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, bufsize=1)
    supervisor = None
    try:
        assert coordinator.stdout.readline().strip() == 'UNTRUSTED_WRITE_AND_KEY_DENIED'
        supervisor = subprocess.Popen(
            [sys.executable, '-B', str(base / 'isolated-uid-supervisor-fixture.py'),
             str(private), str(public), str(coordinator.pid), '65534'],
            close_fds=True, pass_fds=(),
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
        assert supervisor.stdout.readline().strip() == 'GE04_ISOLATED_SUPERVISOR_READY'
        coordinator.stdin.write('GO\n')
        coordinator.stdin.flush()
        assert coordinator.stdout.readline().strip() == 'UNTRUSTED_INERT_SENT'
        assert supervisor.stdout.readline().strip() == 'GE04_ISOLATED_INERT_OBSERVATION_UNVERIFIED'
        assert supervisor.wait(timeout=8) == 0, supervisor.stderr.read()
        coordinator.stdin.write('DONE\n')
        coordinator.stdin.flush()
        assert coordinator.wait(timeout=8) == 0, coordinator.stderr.read()
        state = authority.inspect(private)
        assert state['approvalState'] == 'consumed'
        assert state['consumed'] == ['isolated-inert-attempt']
        assert state['revoked'] is False
        assert (private / 'terminal-observation.json').is_file()
    finally:
        for child in (coordinator, supervisor):
            if child is not None:
                if child.poll() is None:
                    child.kill()
                    child.wait(timeout=8)
                child.stdin and child.stdin.close()
                child.stdout and child.stdout.close()
                child.stderr and child.stderr.close()

print('GE04 isolated supervisor UID boundary PASS: untrusted state/key/receipt writes denied; pinned datagram inert-only')
