#!/usr/bin/env python3
"""SUP-20 privileged regression: SCM_RIGHTS cannot impersonate datagram sender."""
import array
import importlib.util
import os
from pathlib import Path
import socket
import struct
import sys

if sys.platform != 'linux' or os.geteuid() != 0:
    raise SystemExit('GE04 SUP-20 requires root on Linux')

spec = importlib.util.spec_from_file_location(
    'sup20_kernel_creds', Path(__file__).with_name('kernel-message-credentials.py'))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

server, client = socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)
control, child_control = socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)
server.setsockopt(socket.SOL_SOCKET, socket.SO_PASSCRED, 1)
server.settimeout(5)
control.settimeout(5)


def denied(fn):
    try:
        fn()
    except PermissionError:
        return
    raise AssertionError('delegated untrusted datagram was accepted')


try:
    # Authorized fixture sender: exact root UID and PID must match.
    client.send(b'root-inert')
    assert gate.receive_inert_message(server, 0, os.getpid()) == b'root-inert'

    # A sender must not be accepted when the receiving endpoint does not
    # enable the kernel credential facility.
    other_server, other_client = socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)
    try:
        other_client.send(b'no-passcred')
        denied(lambda: gate.receive_inert_message(other_server, 0))
    finally:
        other_server.close()
        other_client.close()

    pid = os.fork()
    if pid == 0:
        try:
            server.close()
            client.close()
            control.close()
            os.setgroups([])
            os.setgid(65534)
            os.setuid(65534)
            msg, ancillary, flags, _ = child_control.recvmsg(
                64, socket.CMSG_SPACE(array.array('i').itemsize))
            if msg != b'handoff' or flags & socket.MSG_CTRUNC:
                raise AssertionError('invalid test handoff')
            fds = []
            for level, kind, raw in ancillary:
                if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                    ints = array.array('i')
                    ints.frombytes(raw[:len(raw) - len(raw) % ints.itemsize])
                    fds.extend(ints)
            if len(fds) != 1:
                raise AssertionError('expected delegated socket')
            with socket.socket(fileno=fds[0]) as delegated:
                delegated.send(b'uid-65534-inert')
            os._exit(0)
        except BaseException:
            os._exit(2)

    child_control.close()
    control.sendmsg([b'handoff'], [(socket.SOL_SOCKET, socket.SCM_RIGHTS,
                                    array.array('i', [client.fileno()]))])
    # SO_PEERCRED is the original root connector and is not used as an
    # authorization decision. SCM_CREDENTIALS is per-message and observes
    # the actual sending process's UID.
    denied(lambda: gate.receive_inert_message(server, 0, os.getpid()))
    waited, status = os.waitpid(pid, 0)
    assert waited == pid and os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0, status
    # A legitimate root sender can still use its original descriptor.
    client.send(b'root-after-delegation')
    assert gate.receive_inert_message(server, 0, os.getpid()) == b'root-after-delegation'
finally:
    server.close()
    client.close()
    control.close()
    child_control.close()

print('GE04 SUP-20 kernel message credentials PASS: delegated distinct-UID datagram denied; original root sender accepted')
