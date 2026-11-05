#!/usr/bin/env python3
"""Root-only GE-04 protected supervisor installation fixture regression."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile

if sys.platform != 'linux' or os.geteuid() != 0:
    raise SystemExit('GE04 protected installation regression requires root Linux')

base = Path(__file__).resolve().parent

def load(name):
    spec = importlib.util.spec_from_file_location(
        'ge04_inst_' + name.replace('-', '_'), base / (name + '.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

installer = load('protected-supervisor-installation')
authority = load('sup25-atomic-authority-fixture')
keys = load('fixture-credential-provisioning')

UNTRUSTED = """
import os, pathlib, sys
installation, private, public = map(pathlib.Path, sys.argv[1:])
assert os.geteuid() == 65534 and os.getegid() == 65534
for action in (
    lambda: (installation / 'installation.json').write_text('forged'),
    lambda: (installation / 'isolated-uid-supervisor-fixture.py').write_text('forged'),
    lambda: (installation / 'kernel-bound-datagram-sender.py').unlink(),
    lambda: installation.chmod(0o777),
    lambda: (private / 'state.json').write_text('forged'),
):
    try:
        action()
    except PermissionError:
        continue
    raise AssertionError('untrusted actor modified protected installation or authority')
print('GE04_INSTALLATION_UNTRUSTED_DENIED', flush=True)
assert sys.stdin.readline().strip() == 'GO'
import socket
with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as client:
    client.sendto(b'GE04_ISOLATED_INERT_REQUEST', str(public / 'inert-request.sock'))
print('GE04_INSTALLATION_INERT_SENT', flush=True)
assert sys.stdin.readline().strip() == 'DONE'
"""

def drop():
    os.setgroups([])
    os.setgid(65534)
    os.setuid(65534)

def rejected(fn):
    try:
        fn()
    except PermissionError:
        return
    raise AssertionError('untrusted supervisor installation accepted')

with tempfile.TemporaryDirectory(prefix='ge04-install-') as name:
    root = Path(name)
    root.chmod(0o711)
    installation = root / 'installed'
    installation.mkdir(mode=0o700)
    private = root / 'private'
    private.mkdir(mode=0o700)
    public = root / 'public'
    public.mkdir(mode=0o711)

    manifest = {}
    for filename in installer.MODULES:
        source = base / filename
        destination = installation / filename
        shutil.copyfile(source, destination)
        destination.chmod(0o600)
        manifest[filename] = hashlib.sha256(destination.read_bytes()).hexdigest()
    manifest_path = installation / installer.MANIFEST
    manifest_path.write_text(json.dumps({'version': 1, 'modules': manifest},
                                        sort_keys=True, separators=(',', ':')) + '\n')
    manifest_path.chmod(0o600)
    assert installer.verify(installation) == 'GE04_INSTALLATION_VERIFIED_UNTRUSTED'

    # Root can test integrity rejection without running a corrupted bundle.
    target = installation / installer.MODULES[0]
    original = target.read_bytes()
    target.write_bytes(original + b'\n# tamper\n')
    rejected(lambda: installer.verify(installation))
    target.write_bytes(original)
    assert installer.verify(installation) == 'GE04_INSTALLATION_VERIFIED_UNTRUSTED'
    manifest_bytes = manifest_path.read_bytes()
    manifest_path.write_bytes(manifest_bytes.replace(b'\"version\":1', b'\"version\":2'))
    rejected(lambda: installer.verify(installation))
    manifest_path.write_bytes(manifest_bytes)
    assert installer.verify(installation) == 'GE04_INSTALLATION_VERIFIED_UNTRUSTED'

    keys.install_fixture_key(private)
    authority.initialize(private, revision=7, lease='fixture-lease',
                         expiry=1000, approval='fixture-approval')
    coordinator = subprocess.Popen(
        [sys.executable, '-B', '-c', UNTRUSTED, str(installation),
         str(private), str(public)], preexec_fn=drop,
        close_fds=True, pass_fds=(),
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, bufsize=1)
    supervisor = None
    try:
        assert coordinator.stdout.readline().strip() == 'GE04_INSTALLATION_UNTRUSTED_DENIED'
        supervisor = installer.launch(installation, private, public,
                                      coordinator.pid, 65534)
        assert supervisor.stdout.readline().strip() == 'GE04_ISOLATED_SUPERVISOR_READY'
        coordinator.stdin.write('GO\n')
        coordinator.stdin.flush()
        assert coordinator.stdout.readline().strip() == 'GE04_INSTALLATION_INERT_SENT'
        assert supervisor.stdout.readline().strip() == 'GE04_ISOLATED_INERT_OBSERVATION_UNVERIFIED'
        assert supervisor.wait(timeout=8) == 0, supervisor.stderr.read()
        coordinator.stdin.write('DONE\n')
        coordinator.stdin.flush()
        assert coordinator.wait(timeout=8) == 0, coordinator.stderr.read()
        state = authority.inspect(private)
        assert state['approvalState'] == 'consumed'
        assert state['consumed'] == ['isolated-inert-attempt']
        assert (private / 'terminal-observation.json').is_file()
        # Child has exited. Stale endpoint and consumed approval must not
        # silently permit a restart, even from the verified installation.
        repeat = installer.launch(installation, private, public, os.getpid(), 0)
        try:
            assert repeat.wait(timeout=8) != 0
        finally:
            repeat.stdout.close()
            repeat.stderr.close()
    finally:
        for child in (coordinator, supervisor):
            if child is not None:
                if child.poll() is None:
                    child.kill()
                    child.wait(timeout=8)
                child.stdin and child.stdin.close()
                child.stdout and child.stdout.close()
                child.stderr and child.stderr.close()

print('GE04 protected supervisor installation PASS: untrusted edits denied; integrity checked; inert launch and stale restart denied')
