#!/usr/bin/env python3
"""GE04 SUP-17: root CI fixture for distinct-UID path access denial.

Only inert filesystem and AF_UNIX permission checks. No helper execution,
supervisor authority, mutation, or secret provisioning beyond a test fixture.
"""
import os
from pathlib import Path
import socket
import sys
import tempfile

if sys.platform != 'linux' or os.geteuid() != 0:
    raise SystemExit('GE04 SUP-17 requires root on Linux')

with tempfile.TemporaryDirectory(prefix='ge04-sup17-') as name:
    root = Path(name)
    root.chmod(0o711)
    protected = root / 'protected'
    protected.mkdir(mode=0o700)
    key = protected / 'fixture.key'
    key.write_bytes(os.urandom(32))
    key.chmod(0o600)
    path = root / 'fixture.sock'
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        listener.bind(str(path))
        path.chmod(0o600)
        listener.listen(1)
        pid = os.fork()
        if pid == 0:
            try:
                os.setgroups([])
                os.setgid(65534)
                os.setuid(65534)
                key_denied = False
                socket_denied = False
                try:
                    key.read_bytes()
                except PermissionError:
                    key_denied = True
                probe = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                try:
                    probe.connect(str(path))
                except PermissionError:
                    socket_denied = True
                finally:
                    probe.close()
                os._exit(0 if key_denied and socket_denied else 2)
            except BaseException:
                os._exit(3)
        waited, status = os.waitpid(pid, 0)
        assert waited == pid and os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0, status
    finally:
        listener.close()

print('GE04 SUP-17 cross-UID path isolation PASS: direct key and socket access denied; delegated FDs unaddressed')
