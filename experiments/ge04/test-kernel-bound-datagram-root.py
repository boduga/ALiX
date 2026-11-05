#!/usr/bin/env python3
"""SUP-22b privileged cross-UID delegated connected datagram adversary."""
import array
import importlib.util
import os
from pathlib import Path
import socket
import sys

if sys.platform != 'linux' or os.geteuid() != 0:
    raise SystemExit('SUP-22b privileged regression requires Linux root')

spec = importlib.util.spec_from_file_location(
    'sup22b', Path(__file__).with_name('kernel-bound-datagram-sender.py'))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


def denied(fn):
    try:
        fn()
    except PermissionError:
        return
    raise AssertionError('delegated socket was accepted')


receiver, sender = socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)
handoff, child_handoff = socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)
gate.configure_receiver(receiver)
receiver.settimeout(5)
handoff.settimeout(5)
try:
    with gate.KernelPinnedSender(os.getpid(), 0) as trusted:
        sender.send(b'root-before-handoff')
        assert trusted.receive(receiver) == b'root-before-handoff'
        pid = os.fork()
        if pid == 0:
            try:
                receiver.close()
                sender.close()
                handoff.close()
                os.setgroups([])
                os.setgid(65534)
                os.setuid(65534)
                _, ancillary, flags, _ = child_handoff.recvmsg(
                    64, socket.CMSG_SPACE(array.array('i').itemsize))
                if flags & socket.MSG_CTRUNC:
                    os._exit(3)
                fds = []
                for level, kind, data in ancillary:
                    if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                        ints = array.array('i')
                        ints.frombytes(data[:len(data) - len(data) % ints.itemsize])
                        fds.extend(ints)
                if len(fds) != 1:
                    os._exit(4)
                with socket.socket(fileno=fds[0]) as delegated:
                    delegated.send(b'dropped-uid-delegated')
                os._exit(0)
            except BaseException:
                os._exit(2)
        child_handoff.close()
        handoff.sendmsg([b'fd'], [(socket.SOL_SOCKET, socket.SCM_RIGHTS,
                                   array.array('i', [sender.fileno()]))])
        denied(lambda: trusted.receive(receiver))
        _, status = os.waitpid(pid, 0)
        assert os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0, status
        sender.send(b'root-after-handoff')
        assert trusted.receive(receiver) == b'root-after-handoff'
finally:
    receiver.close()
    sender.close()
    handoff.close()
    child_handoff.close()

print('GE04 SUP-22b cross-UID pidfd PASS: delegated AF_UNIX datagram denied; original trusted sender accepted')
