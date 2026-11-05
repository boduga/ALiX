#!/usr/bin/env python3
"""SUP-21 inert per-message identity and descriptor rejection regressions."""
import array
import importlib.util
import os
from pathlib import Path
import socket
import sys

if sys.platform != 'linux':
    raise SystemExit('GE04 SUP-21 requires Linux')
spec = importlib.util.spec_from_file_location(
    'sup21_gate', Path(__file__).with_name('kernel-message-credentials.py'))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


def denied(fn):
    try:
        fn()
    except PermissionError:
        return
    raise AssertionError('unexpected message accepted')


server, client = socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)
server.setsockopt(socket.SOL_SOCKET, socket.SO_PASSCRED, 1)
server.settimeout(5)
try:
    # Matching UID alone does not establish an expected process identity.
    pid = os.fork()
    if pid == 0:
        try:
            server.close()
            client.send(b'same-uid-different-pid')
            os._exit(0)
        except BaseException:
            os._exit(2)
    denied(lambda: gate.receive_inert_message(server, os.geteuid(), os.getpid()))
    _, status = os.waitpid(pid, 0)
    assert os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0, status

    client.send(b'expected-process')
    assert gate.receive_inert_message(server, os.geteuid(), os.getpid()) == b'expected-process'

    # Unexpected SCM_RIGHTS is denied and closed, even with a valid sender.
    read_fd, write_fd = os.pipe()
    try:
        baseline = len(os.listdir('/proc/self/fd'))
        client.sendmsg([b'with-fd'], [(socket.SOL_SOCKET, socket.SCM_RIGHTS,
                                      array.array('i', [read_fd]))])
        denied(lambda: gate.receive_inert_message(server, os.geteuid(), os.getpid()))
        assert len(os.listdir('/proc/self/fd')) == baseline, 'received descriptor leaked'
    finally:
        os.close(read_fd)
        os.close(write_fd)

    client.send(b'x' * (gate.MAX_FRAME + 1))
    denied(lambda: gate.receive_inert_message(server, os.geteuid(), os.getpid()))
    client.send(b'')
    denied(lambda: gate.receive_inert_message(server, os.geteuid(), os.getpid()))
finally:
    server.close()
    client.close()

print('GE04 SUP-21 message identity PASS: same-UID wrong PID denied; SCM_RIGHTS closed; oversized and empty denied')
