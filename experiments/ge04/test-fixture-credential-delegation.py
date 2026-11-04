#!/usr/bin/env python3
"""SUP-15 real SCM_RIGHTS handoff exposes unresolved authenticated-FD risk."""
import array
import hashlib
import importlib.util
import os
from pathlib import Path
import socket
import struct
import tempfile

def load(name):
    spec = importlib.util.spec_from_file_location(
        'ge04_' + name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    obj = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj

provision = load('fixture-credential-provisioning')
session = load('ephemeral-ipc-session')
transport = load('real-ipc-session-transport')

def denied(fn):
    try:
        fn()
    except (PermissionError, ValueError, FileExistsError, OSError):
        return
    raise AssertionError('unsafe credential fixture accepted')

with tempfile.TemporaryDirectory(prefix='ge04-sup15-', dir=Path.home()) as tmp:
    root = Path(tmp)
    root.chmod(0o700)
    assert provision.install_fixture_key(root) == 'KEY_FIXTURE_INSTALLED_UNTRUSTED'
    secret = provision.read_fixture_key(root, os.geteuid())
    assert len(secret) == 32
    denied(lambda: provision.install_fixture_key(root))
    (root / 'coordinator.fixture.key').chmod(0o644)
    denied(lambda: provision.read_fixture_key(root, os.geteuid()))
    (root / 'coordinator.fixture.key').chmod(0o600)
    root.chmod(0o777)
    denied(lambda: provision.read_fixture_key(root, os.geteuid()))
    root.chmod(0o700)
    alias = root / 'alias'
    alias.symlink_to(root / 'coordinator.fixture.key')
    # Replace only the test credential with a symlink; never follow it.
    (root / 'coordinator.fixture.key').unlink()
    (root / 'coordinator.fixture.key').symlink_to(alias)
    denied(lambda: provision.read_fixture_key(root, os.geteuid()))

# In-memory test session with a delegated socket FD. A forked process
# receives a real SCM_RIGHTS descriptor and a precomputed authenticated
# request. Since fork inherits memory, this does NOT demonstrate key isolation.
# The receiver cannot distinguish who transmitted using SO_PEERCRED alone.
server = session.TestServer(secret, b'test-peer')
client = session.TestClient(secret, b'test-peer')
assert server.establish(client.respond(server.issue())) == 'SESSION_OBSERVED_UNTRUSTED'
request = client.make_request(1, 'inert-delegated', hashlib.sha256(b'inert').digest())
server_sock, original_client = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)
control_parent, control_child = socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)
original_peer_pid = os.getpid()
observed_before = struct.unpack('3i', server_sock.getsockopt(
    socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize('3i')))
try:
    pid = os.fork()
    if pid == 0:
        try:
            server_sock.close()
            original_client.close()
            control_parent.close()
            msg, anc, _flags, _addr = control_child.recvmsg(128, socket.CMSG_SPACE(array.array('i', [0]).itemsize))
            assert msg == request[:len(msg)] or msg == b'handoff'
            fds = [int(x) for level, kind, data in anc
                   if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS
                   for x in array.array('i', data[:len(data) - len(data) % array.array('i').itemsize])]
            assert len(fds) == 1
            with socket.socket(fileno=fds[0]) as delegated:
                transport.write_frame(delegated, request)
            os._exit(0)
        except BaseException:
            os._exit(2)
    control_child.close()
    control_parent.sendmsg([b'handoff'], [(socket.SOL_SOCKET, socket.SCM_RIGHTS,
                                          array.array('i', [original_client.fileno()]))])
    original_client.close()
    server_sock.settimeout(5)
    actual = transport.read_frame(server_sock)
    observed = server.request(actual)
    waited, status = os.waitpid(pid, 0)
    assert waited == pid and os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0
    assert observed == 'REQUEST_OBSERVED_UNTRUSTED'
    observed_after = struct.unpack('3i', server_sock.getsockopt(
        socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize('3i')))
    assert observed_after == observed_before
    # This positive observation is evidence of an unresolved control gap.
    assert original_peer_pid != pid
finally:
    server_sock.close()
    control_parent.close()
    server.close()

print('GE04 SUP-15 fixture provisioning PASS: unsafe key paths rejected; SCM_RIGHTS delegation risk REPRODUCED_UNTRUSTED')
