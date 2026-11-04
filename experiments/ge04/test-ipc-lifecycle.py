#!/usr/bin/env python3
"""GE04 SUP-14 inert session lifecycle regression; no mutation authority."""
import importlib.util
import os
from pathlib import Path
import socket
import struct

spec = importlib.util.spec_from_file_location(
    'sup14_session', Path(__file__).with_name('ephemeral-ipc-session.py'))
session = importlib.util.module_from_spec(spec)
spec.loader.exec_module(session)

def denied(action):
    try:
        action()
    except (PermissionError, ValueError):
        return
    raise AssertionError('closed or invalid session accepted')

def pair(secret, label):
    server = session.TestServer(secret, label)
    client = session.TestClient(secret, label)
    assert server.establish(client.respond(server.issue())) == 'SESSION_OBSERVED_UNTRUSTED'
    return server, client

label = b'fixture-role-not-authority'
old_key = os.urandom(32)
server, client = pair(old_key, label)
digest = bytes(32)
old_request = client.make_request(1, 'inert', digest)
assert server.request(old_request) == 'REQUEST_OBSERVED_UNTRUSTED'
server.close()
denied(lambda: server.request(old_request))
denied(server.issue)

new_key = os.urandom(32)
assert new_key != old_key
fresh, fresh_client = pair(new_key, label)
denied(lambda: fresh.request(old_request))
assert fresh.request(fresh_client.make_request(1, 'inert', digest)) == 'REQUEST_OBSERVED_UNTRUSTED'
fresh.close()

# A socket descriptor inherited by another process keeps its original peer
# identity. This is evidence of a delegation limitation, NOT authorization.
left, right = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)
try:
    before = struct.unpack('3i', left.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize('3i')))
    pid = os.fork()
    if pid == 0:
        try:
            after = struct.unpack('3i', left.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize('3i')))
            os._exit(0 if after == before else 2)
        except BaseException:
            os._exit(3)
    waited, status = os.waitpid(pid, 0)
    assert waited == pid and os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0
finally:
    left.close()
    right.close()

print('GE04 SUP-14 lifecycle PASS: close, fresh key, stale request and inherited credentials observed')
