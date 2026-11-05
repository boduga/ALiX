#!/usr/bin/env python3
"""SUP-22b inert kernel sender-pidfd binding and negative tests."""
import array
import importlib.util
import os
from pathlib import Path
import socket
import sys

if sys.platform != 'linux':
    raise SystemExit('SUP-22b requires Linux')

spec = importlib.util.spec_from_file_location(
    'sup22b', Path(__file__).with_name('kernel-bound-datagram-sender.py'))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


def denied(fn):
    try:
        fn()
    except (PermissionError, ProcessLookupError):
        return
    raise AssertionError('untrusted message accepted')


server, sender = socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)
server.settimeout(5)
try:
    gate.configure_receiver(server)
    with gate.KernelPinnedSender(os.getpid(), os.geteuid()) as pin:
        sender.send(b'parent-valid')
        assert pin.receive(server) == b'parent-valid'
        # Kernel pidfd must have exactly the pinned sender identity even
        # if the unauthorized sender is the same UID and uses an inherited
        # copy of the trusted process's sending socket.
        pid = os.fork()
        if pid == 0:
            try:
                server.close()
                sender.send(b'child-inherited-descriptor')
                os._exit(0)
            except BaseException:
                os._exit(2)
        denied(lambda: pin.receive(server))
        _, status = os.waitpid(pid, 0)
        assert os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0, status
        sender.send(b'parent-valid-again')
        assert pin.receive(server) == b'parent-valid-again'

        read_fd, write_fd = os.pipe()
        try:
            baseline = len(os.listdir('/proc/self/fd'))
            sender.sendmsg([b'descriptor'], [
                (socket.SOL_SOCKET, socket.SCM_RIGHTS,
                 array.array('i', [read_fd]))])
            denied(lambda: pin.receive(server))
            assert len(os.listdir('/proc/self/fd')) == baseline, 'ancillary FD leaked'
        finally:
            os.close(read_fd)
            os.close(write_fd)

        sender.send(b'x' * (gate.MAX_FRAME + 1))
        denied(lambda: pin.receive(server))
        sender.send(b'')
        denied(lambda: pin.receive(server))
    denied(lambda: pin.receive(server))
finally:
    server.close()
    sender.close()

# Missing either kernel-attestation facility must fail closed, even when
# the numeric sender PID and UID would otherwise be correct.
for passcred, passpidfd in ((True, False), (False, True), (False, False)):
    receiver, client = socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)
    try:
        if passcred:
            receiver.setsockopt(socket.SOL_SOCKET, socket.SO_PASSCRED, 1)
        if passpidfd:
            receiver.setsockopt(socket.SOL_SOCKET, gate.SO_PASSPIDFD, 1)
        with gate.KernelPinnedSender(os.getpid(), os.geteuid()) as pin:
            client.send(b'not-attested')
            denied(lambda: pin.receive(receiver))
    finally:
        receiver.close()
        client.close()

# A datagram queued by a formerly valid sender must not be accepted after
# the sender exits: the pinned pidfd proves that that instance is gone.
server, sender = socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)
gate.configure_receiver(server)
server.settimeout(5)
ready_r, ready_w = os.pipe()
finish_r, finish_w = os.pipe()
pid = os.fork()
if pid == 0:
    try:
        server.close()
        os.close(ready_r)
        os.close(finish_w)
        os.write(ready_w, b'R')
        if os.read(finish_r, 1) != b'1':
            os._exit(3)
        sender.send(b'live-child')
        if os.read(finish_r, 1) != b'2':
            os._exit(4)
        sender.send(b'queued-then-exited')
        os._exit(0)
    except BaseException:
        os._exit(2)
sender.close()
os.close(ready_w)
os.close(finish_r)
try:
    assert os.read(ready_r, 1) == b'R'
    with gate.KernelPinnedSender(pid, os.geteuid()) as pin:
        os.write(finish_w, b'1')
        assert pin.receive(server) == b'live-child'
        os.write(finish_w, b'2')
        _, status = os.waitpid(pid, 0)
        assert os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0, status
        denied(lambda: pin.receive(server))
finally:
    server.close()
    os.close(ready_r)
    os.close(finish_w)

print('GE04 SUP-22b message pidfd PASS: same-UID inherited FD denied; kernel handle matched; stale queued denied; FD closed')
