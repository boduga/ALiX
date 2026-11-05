#!/usr/bin/env python3
"""SUP-22 deterministic live, stale, tampered birth and PID mismatch tests."""
import importlib.util
import os
from pathlib import Path
import socket
import sys

if sys.platform != 'linux':
    raise SystemExit('GE04 SUP-22 requires Linux')
spec = importlib.util.spec_from_file_location(
    'sup22_lifecycle', Path(__file__).with_name('pidfd-message-lifecycle.py'))
lifecycle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lifecycle)


def denied(fn):
    try:
        fn()
    except (PermissionError, ProcessLookupError):
        return
    raise AssertionError('unverified sender accepted')


server, sender = socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)
server.setsockopt(socket.SOL_SOCKET, socket.SO_PASSCRED, 1)
server.settimeout(5)
ready_r, ready_w = os.pipe()
release_r, release_w = os.pipe()
pid = os.fork()
if pid == 0:
    try:
        server.close()
        os.close(ready_r)
        os.close(release_w)
        os.write(ready_w, b'R')
        if os.read(release_r, 1) != b'G':
            os._exit(3)
        sender.send(b'live-child-message')
        # Remain alive until parent reads; then send another message which
        # parent only processes after exit to verify stale queue rejection.
        if os.read(release_r, 1) != b'Q':
            os._exit(4)
        sender.send(b'queued-before-exit')
        os._exit(0)
    except BaseException:
        os._exit(2)

sender.close()
os.close(ready_w)
os.close(release_r)
try:
    assert os.read(ready_r, 1) == b'R'
    with lifecycle.PinnedSender(pid, os.geteuid()) as pinned:
        assert pinned.fd >= 0
        os.write(release_w, b'G')
        assert pinned.receive(server) == b'live-child-message'

        # An incorrect pinned birth timestamp must fail closed.
        actual = pinned.birth
        pinned.birth = actual + 1
        denied(pinned.verify)
        pinned.birth = actual
        pinned.verify()

        os.write(release_w, b'Q')
        waited, status = os.waitpid(pid, 0)
        assert waited == pid and os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0, status
        denied(pinned.verify)
        # The datagram was sent while the child was alive. Receiving after
        # it exited must not restore authority from a queued message.
        denied(lambda: pinned.receive(server))
    denied(pinned.verify)

    # An unrelated same-UID process cannot replace the previously pinned pid.
    with lifecycle.PinnedSender(os.getpid(), os.geteuid()) as parent_pin:
        client = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
        try:
            # Use a separately-created connected pair so real sender identity
            # is the parent, while the receiver expects dead child's PID.
            new_server, new_client = socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)
            try:
                new_server.setsockopt(socket.SOL_SOCKET, socket.SO_PASSCRED, 1)
                new_client.send(b'parent-not-child')
                denied(lambda: lifecycle.PinnedSender(pid, os.geteuid()))
                assert parent_pin.receive(new_server) == b'parent-not-child'
            finally:
                new_server.close()
                new_client.close()
        finally:
            client.close()
finally:
    server.close()
    os.close(ready_r)
    os.close(release_w)

print('GE04 SUP-22 pidfd lifecycle PASS: live accepted; stale queued denied; tampered birth denied; closed pin denied')
