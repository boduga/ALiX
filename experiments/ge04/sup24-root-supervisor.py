#!/usr/bin/env python3
"""SUP-24: nonce-bound, single-use inert exchange in a fresh root subprocess.

A challenge is NOT authorization or secret authentication. Kernel sender pin
is verified per datagram. This fixture does not execute any mutation.
"""
import importlib.util
import os
from pathlib import Path
import socket
import stat
import sys


def load(name):
    spec = importlib.util.spec_from_file_location(
        'sup24_' + name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    obj = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj


gate = load('kernel-bound-datagram-sender')
credential = load('fixture-credential-provisioning')
HELLO = b'SUP24_HELLO'
PREFIX = b'SUP24_RESPONSE:'
ACK = b'SUP24_OBSERVED_UNTRUSTED'


def run(root, coordinator_pid):
    if sys.platform != 'linux' or os.geteuid() != 0:
        raise PermissionError('root Linux fixture required')
    directory = Path(root)
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        st = os.fstat(fd)
        if (st.st_uid != 0 or not stat.S_ISDIR(st.st_mode) or
                st.st_mode & 0o077):
            raise PermissionError('unsafe supervisor directory')
        if len(credential.read_fixture_key(directory, 0)) != 32:
            raise PermissionError('invalid fixture key')
        # Root credential is intentionally *not* used as coordinator shared
        # authentication or a claim of independently protected authority.
        try:
            os.stat('sup24-supervisor.sock', dir_fd=fd, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            raise FileExistsError('orphan supervisor endpoint: manual cleanup required')
        reply = os.stat('sup24-reply.sock', dir_fd=fd, follow_symlinks=False)
        if (not stat.S_ISSOCK(reply.st_mode) or reply.st_uid != 0 or
                reply.st_mode & 0o077):
            raise PermissionError('unsafe reply endpoint')
    except BaseException:
        os.close(fd)
        raise
    try:
        with gate.KernelPinnedSender(coordinator_pid, 0) as pin:
            with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as receiver:
                gate.configure_receiver(receiver)
                receiver.bind('/proc/self/fd/' + str(fd) + '/sup24-supervisor.sock')
                os.chmod('sup24-supervisor.sock', 0o600, dir_fd=fd, follow_symlinks=False)
                receiver.settimeout(5)
                nonce = os.urandom(32).hex().encode('ascii')
                print('SUP24_READY', flush=True)
                if pin.receive(receiver) != HELLO:
                    raise PermissionError('invalid initial session message')
                with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as outbound:
                    outbound.sendto(b'SUP24_CHALLENGE:' + nonce, str(directory / 'sup24-reply.sock'))
                # Exactly one response attempt; wrong/stale challenge consumes
                # the session. No retry or second admission.
                response = pin.receive(receiver)
                if response != PREFIX + nonce:
                    raise PermissionError('stale or incorrect challenge')
                with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as outbound:
                    outbound.sendto(ACK, str(directory / 'sup24-reply.sock'))
                return 'SUP24_INERT_SESSION_OBSERVED'
    finally:
        os.close(fd)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('usage: sup24-root-supervisor.py ROOT PINNED_PID')
    print(run(sys.argv[1], int(sys.argv[2])), flush=True)
