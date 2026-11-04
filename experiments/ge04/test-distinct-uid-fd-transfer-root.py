#!/usr/bin/env python3
"""GE04 SUP-16 privileged distinct-UID descriptor transfer regression.

Tests an inert precomputed request. A distinct-UID exec'd child cannot open
protected resources directly, but CAN use an intentionally delegated socket.
This demonstrates the gap; it does not provide a security mitigation.
"""
import array
import hashlib
import importlib.util
import os
from pathlib import Path
import socket
import struct
import subprocess
import sys
import tempfile

if sys.platform != 'linux' or os.geteuid() != 0:
    raise SystemExit('GE04 SUP-16 privileged fixture requires root on Linux')


def load(name):
    spec = importlib.util.spec_from_file_location(
        'ge04_sup16_' + name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


protocol = load('ephemeral-ipc-session')
transport = load('real-ipc-session-transport')


def drop_identity():
    os.setgroups([])
    os.setgid(65534)
    os.setuid(65534)


with tempfile.TemporaryDirectory(prefix='ge04-sup16-') as dirname:
    root = Path(dirname)
    root.chmod(0o711)
    keydir = root / 'protected'
    keydir.mkdir(mode=0o700)
    credential = keydir / 'fixture.key'
    secret = os.urandom(32)
    credential.write_bytes(secret)
    credential.chmod(0o600)

    path = root / 'protected.sock'
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    listener.bind(str(path))
    path.chmod(0o600)
    listener.listen(1)
    parent, offered = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)
    control, child_control = socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)
    try:
        fixture = protocol.TestServer(secret, b'inert-root-fixture')
        author = protocol.TestClient(secret, b'inert-root-fixture')
        assert fixture.establish(author.respond(fixture.issue())) == 'SESSION_OBSERVED_UNTRUSTED'
        request = author.make_request(1, 'inert-cross-uid', hashlib.sha256(b'inert').digest())
        original_peer = parent.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED,
                                          struct.calcsize('3i'))
        # A fresh Python exec erases inherited Python secrets and objects.
        proc = subprocess.Popen(
            [sys.executable, '-B',
             str(Path(__file__).with_name('sup16-distinct-uid-child.py')),
             str(child_control.fileno()), str(credential), str(path)],
            pass_fds=(child_control.fileno(),), preexec_fn=drop_identity,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        child_control.close()
        control.sendmsg([request], [(socket.SOL_SOCKET, socket.SCM_RIGHTS,
                                     array.array('i', [offered.fileno()]))])
        offered.close()
        parent.settimeout(5)
        try:
            actual = transport.read_frame(parent)
        except (OSError, ConnectionError, TimeoutError) as exc:
            out, err = proc.communicate(timeout=8)
            raise AssertionError(('delegated child failed before inert request',
                                  proc.returncode, out, err)) from exc
        result = fixture.request(actual)
        out, err = proc.communicate(timeout=8)
        assert proc.returncode == 0, (out, err)
        assert result == 'REQUEST_OBSERVED_UNTRUSTED'
        after_peer = parent.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED,
                                        struct.calcsize('3i'))
        assert original_peer == after_peer
        original_pid, original_uid, _ = struct.unpack('3i', after_peer)
        assert original_uid == 0 and original_pid == os.getpid() and proc.pid != original_pid
        fixture.close()
    finally:
        listener.close()
        parent.close()
        offered.close()
        control.close()
        child_control.close()

print('GE04 SUP-16 distinct-UID FD transfer PASS: protected paths denied; delegated authenticated request REPRODUCED_UNTRUSTED')
