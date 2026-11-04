#!/usr/bin/env python3
"""SUP-10 endpoint lifecycle experiment, no authorization."""
import importlib.util
import os
from pathlib import Path
import socket
import stat
import tempfile

def load(name):
    spec = importlib.util.spec_from_file_location('ge04_endpoint', Path(__file__).with_name(name + '.py'))
    obj = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj

mod = load('supervisor-endpoint-bootstrap')
def rejected(action):
    try:
        action()
    except (OSError, ValueError, PermissionError):
        return
    raise AssertionError('unsafe fixture accepted')

with tempfile.TemporaryDirectory(prefix='ge04-sup10-', dir=Path.home()) as name:
    base = Path(name)
    base.chmod(0o700)
    root = base / 'endpoint'
    root.mkdir(mode=0o700)
    server = mod.bootstrap(root, os.geteuid())
    location = root / 'supervisor.sock'
    assert stat.S_ISSOCK(location.lstat().st_mode)
    assert stat.S_IMODE(location.stat().st_mode) == 0o600
    assert server.check() == 'ENDPOINT_OBSERVED_UNTRUSTED'
    rejected(lambda: mod.bootstrap(root, os.geteuid()))
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.connect(str(location))
        with server.accept() as conn:
            assert conn.family == socket.AF_UNIX
    server.close()
    rejected(lambda: mod.bootstrap(root, os.geteuid()))
    location.unlink()
    location.symlink_to(base / 'other')
    rejected(lambda: mod.bootstrap(root, os.geteuid()))
    location.unlink()
    root.chmod(0o777)
    rejected(lambda: mod.bootstrap(root, os.geteuid()))
    root.chmod(0o700)
    alias = base / 'alias'
    alias.symlink_to(root, target_is_directory=True)
    rejected(lambda: mod.bootstrap(alias, os.geteuid()))
    second = mod.bootstrap(root, os.geteuid())
    try:
        assert second.check() == 'ENDPOINT_OBSERVED_UNTRUSTED'
        location.unlink()
        location.symlink_to(base / 'other')
        rejected(second.check)
    finally:
        second.close()
print('GE04 SUP-10 endpoint bootstrap PASS: protected socket, stale restart, substitution denied')
