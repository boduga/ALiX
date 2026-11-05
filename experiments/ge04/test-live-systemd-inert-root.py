#!/usr/bin/env python3
"""GE-04 ephemeral GitHub-runner systemd lifecycle test. Inert service only.

NEVER run on a production host. Explicit opt-in environment variable and
refusal to overwrite existing paths prevent accidental host installation.
Installs no enabled unit: temporary /run/systemd/system file is removed.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import stat
import subprocess
import sys
import time

ROOTS = {
    'unit': Path('/run/systemd/system/alix-ge04-inert-supervisor.service'),
    'install': Path('/opt/alix/ge04'),
    'config': Path('/etc/alix-ge04-inert'),
    'private': Path('/var/lib/alix-ge04-inert'),
    'public': Path('/run/alix-ge04-inert'),
}
UNIT = 'alix-ge04-inert-supervisor.service'
base = Path(__file__).resolve().parent
if (os.environ.get('ALIX_GE04_EPHEMERAL_SYSTEMD_TEST') != '1' or
        os.environ.get('CI') != 'true' or os.geteuid() != 0 or
        not Path('/run/systemd/system').is_dir() or
        not Path('/run/systemd/private').exists()):
    raise SystemExit('GE04: ephemeral systemd test requires explicit CI+root+systemd opt-in')
if any(path.exists() or path.is_symlink() for path in ROOTS.values()):
    raise SystemExit('GE04: test refuses to overwrite an existing installation or unit')

def load(name):
    spec = importlib.util.spec_from_file_location('ge04_managed_' + name.replace('-', '_'),
                                                  base / (name + '.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

installer = load('protected-supervisor-installation')
authority = load('sup25-atomic-authority-fixture')
keys = load('fixture-credential-provisioning')

UNTRUSTED = """
import os, pathlib, socket, sys
assert os.geteuid() == 65534 and os.getegid() == 65534
for path in ('/opt/alix/ge04/installation.json',
             '/etc/alix-ge04-inert/bootstrap.json',
             '/var/lib/alix-ge04-inert/state.json'):
    try:
        pathlib.Path(path).write_text('forged')
    except PermissionError:
        continue
    raise AssertionError('protected service material writable by untrusted coordinator')
print('SYSTEMD_UNTRUSTED_DENIED', flush=True)
assert sys.stdin.readline().strip() == 'SEND'
with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as sender:
    sender.sendto(b'GE04_ISOLATED_INERT_REQUEST',
                  '/run/alix-ge04-inert/inert-request.sock')
print('SYSTEMD_INERT_SENT', flush=True)
assert sys.stdin.readline().strip() == 'DONE'
"""

def cmd(*args, check=True, timeout=12):
    p = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if check and p.returncode:
        raise AssertionError((args, p.returncode, p.stdout, p.stderr))
    return p

def drop():
    os.setgroups([])
    os.setgid(65534)
    os.setuid(65534)

def service_status():
    return cmd('systemctl', 'show', UNIT, '--property=ActiveState,SubState,Result,NRestarts',
               check=False).stdout

made_parent = False
coordinator = None
try:
    root = ROOTS['install']
    if not root.parent.exists():
        root.parent.mkdir(mode=0o755, parents=True)
        made_parent = True
    root.mkdir(mode=0o700)
    modules = {}
    for filename in installer.MODULES:
        target = root / filename
        shutil.copyfile(base / filename, target)
        target.chmod(0o600)
        modules[filename] = hashlib.sha256(target.read_bytes()).hexdigest()
    (root / 'installation.json').write_text(
        json.dumps({'version': 1, 'modules': modules}, sort_keys=True) + '\n')
    (root / 'installation.json').chmod(0o600)

    ROOTS['config'].mkdir(mode=0o700)
    # State/RuntimeDirectory are created by systemd at service launch, but
    # install fixture state in advance and assert its protected mode.
    ROOTS['private'].mkdir(mode=0o700)
    keys.install_fixture_key(ROOTS['private'])
    authority.initialize(ROOTS['private'], revision=7, lease='fixture-lease',
                         expiry=1000, approval='fixture-approval')
    coordinator = subprocess.Popen(
        [sys.executable, '-B', '-c', UNTRUSTED], preexec_fn=drop,
        close_fds=True, pass_fds=(), stdin=subprocess.PIPE,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    # Parent public directory is created by systemd, so child remains idle
    # until service signals a socket endpoint is available.
    bootstrap = {
        'version': 1, 'installation': str(ROOTS['install']),
        'private': str(ROOTS['private']), 'public': str(ROOTS['public']),
        'coordinatorPid': coordinator.pid, 'coordinatorUid': 65534,
    }
    config = ROOTS['config'] / 'bootstrap.json'
    config.write_text(json.dumps(bootstrap, sort_keys=True) + '\n')
    config.chmod(0o600)
    ROOTS['unit'].write_bytes((base / UNIT).read_bytes())
    ROOTS['unit'].chmod(0o644)
    cmd('systemd-analyze', 'verify', str(ROOTS['unit']))
    cmd('systemctl', 'daemon-reload')
    assert coordinator.stdout.readline().strip() == 'SYSTEMD_UNTRUSTED_DENIED'
    cmd('systemctl', 'start', UNIT)
    deadline = time.monotonic() + 9
    endpoint = ROOTS['public'] / 'inert-request.sock'
    while time.monotonic() < deadline and not endpoint.exists():
        if 'Result=exit-code' in service_status():
            break
        time.sleep(0.05)
    assert endpoint.exists(), service_status()
    s = endpoint.stat()
    # Socket mode 0666 is intentional for the distinct-UID inert sender;
    # security comes from the kernel sender pin and non-writable 0711 parent.
    assert stat.S_ISSOCK(s.st_mode) and s.st_uid == 0 and s.st_mode & 0o777 == 0o666
    public_meta = ROOTS['public'].stat()
    assert public_meta.st_uid == 0 and public_meta.st_mode & 0o777 == 0o711
    coordinator.stdin.write('SEND\n')
    coordinator.stdin.flush()
    assert coordinator.stdout.readline().strip() == 'SYSTEMD_INERT_SENT'
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        st = service_status()
        if 'ActiveState=inactive' in st or 'ActiveState=failed' in st:
            break
        time.sleep(0.1)
    assert 'Result=success' in st and 'ActiveState=inactive' in st, st
    assert 'NRestarts=0' in st, st
    state = authority.inspect(ROOTS['private'])
    assert state['approvalState'] == 'consumed' and state['consumed'] == ['isolated-inert-attempt']
    assert (ROOTS['private'] / 'terminal-observation.json').exists()
    coordinator.stdin.write('DONE\n')
    coordinator.stdin.flush()
    assert coordinator.wait(timeout=5) == 0, coordinator.stderr.read()
    # Systemd may garbage-collect this inactive, unenabled test unit.
    # Clearing a start limit is best-effort when the unit is already unloaded.
    cmd('systemctl', 'reset-failed', UNIT, check=False)
    # Orphaned endpoint must block restart; service remains deny-default.
    cmd('systemctl', 'start', UNIT, check=False)
    deadline = time.monotonic() + 6
    while time.monotonic() < deadline:
        st = service_status()
        if 'ActiveState=failed' in st:
            break
        time.sleep(0.1)
    # Rejection must be an actual process exit, not merely systemd rate-limit.
    assert ('ActiveState=failed' in st and 'Result=exit-code' in st and
            'NRestarts=0' in st), st
    assert authority.inspect(ROOTS['private'])['consumed'] == ['isolated-inert-attempt']
    print('GE04 live systemd inert lifecycle PASS: real manager startup; distinct UID denied; inert request; stale restart fail closed')
except BaseException:
    print('GE04 live systemd failure status:', service_status(), file=sys.stderr)
    details = cmd('journalctl', '-u', UNIT, '-n', '45', '--no-pager', check=False)
    print('GE04 live systemd journal:', details.stdout, details.stderr, file=sys.stderr)
    raise
finally:
    cmd('systemctl', 'stop', UNIT, check=False)
    cmd('systemctl', 'reset-failed', UNIT, check=False)
    if coordinator is not None:
        if coordinator.poll() is None:
            coordinator.kill()
            coordinator.wait(timeout=5)
        coordinator.stdin.close()
        coordinator.stdout.close()
        coordinator.stderr.close()
    ROOTS['unit'].unlink(missing_ok=True)
    cmd('systemctl', 'daemon-reload', check=False)
    for path in (ROOTS['config'], ROOTS['private'], ROOTS['public'], ROOTS['install']):
        if path.exists() and path.is_dir():
            shutil.rmtree(path)
    if made_parent and ROOTS['install'].parent.exists():
        ROOTS['install'].parent.rmdir()
