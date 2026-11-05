#!/usr/bin/env python3
"""GE-04 SUP-23: separate root-only inert supervisor process, never mutation."""
import importlib.util
import os
from pathlib import Path
import socket
import stat
import sys


def load(name):
    spec = importlib.util.spec_from_file_location(
        'sup23_' + name.replace('-', '_'),
        Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


credential = load('fixture-credential-provisioning')
sender_gate = load('kernel-bound-datagram-sender')


def serve(root, pinned_pid):
    if sys.platform != 'linux' or os.geteuid() != 0:
        raise PermissionError('privileged Linux fixture required')
    directory = Path(root)
    fd = os.open(directory, os.O_DIRECTORY | os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        st = os.fstat(fd)
        if st.st_uid != 0 or not stat.S_ISDIR(st.st_mode) or st.st_mode & 0o077:
            raise PermissionError('protected root-owned supervisor directory required')
        secret = credential.read_fixture_key(directory, 0)
        if len(secret) != 32:
            raise PermissionError('invalid supervisor fixture credential')
        # The secret deliberately stays in the supervisor process. It is not
        # transmitted, shared by FD, used for admission or returned to caller.
        os.umask(0o077)
        endpoint = directory / 'supervisor-dgram.sock'
        reply = directory / 'coordinator-reply.sock'
        # Do not overwrite prior socket or symlink after crash.
        try:
            os.stat('supervisor-dgram.sock', dir_fd=fd, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            raise FileExistsError('manual recovery required')
        with sender_gate.KernelPinnedSender(pinned_pid, 0) as pin:
            with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as receiver:
                sender_gate.configure_receiver(receiver)
                receiver.bind('/proc/self/fd/' + str(fd) + '/supervisor-dgram.sock')
                os.chmod('supervisor-dgram.sock', 0o600, dir_fd=fd, follow_symlinks=False)
                receiver.settimeout(8)
                print('SUP23_READY', flush=True)
                try:
                    payload = pin.receive(receiver)
                    # Inert fixed command; no caller-controlled filesystem
                    # action and no key bytes disclosed in response.
                    if payload != b'SUP23_INERT_PROBE':
                        raise PermissionError('unsupported inert request')
                    with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as outbound:
                        outbound.sendto(b'SUP23_OBSERVED_UNTRUSTED', str(reply))
                except (OSError, PermissionError, ValueError):
                    # Failure never produces a successful response.
                    raise
    finally:
        os.close(fd)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('usage: sup23-root-supervisor.py ROOT PID')
    serve(sys.argv[1], int(sys.argv[2]))
