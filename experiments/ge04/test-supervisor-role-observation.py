#!/usr/bin/env python3
"""GE04 SUP-11 real Linux IPC identity observations and negative cases."""
import importlib.util
import multiprocessing as mp
import os
from pathlib import Path
import socket
import sys
import tempfile

if sys.platform != 'linux' or not hasattr(os, 'pidfd_open'):
    raise SystemExit('GE04 SUP-11 requires Linux pidfd_open')
spec = importlib.util.spec_from_file_location(
    'ge04_role', Path(__file__).with_name('supervisor-role-observation.py'))
role = importlib.util.module_from_spec(spec)
spec.loader.exec_module(role)


def client(path, ready, release):
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        sock.connect(str(path))
        ready.set()
        assert release.wait(8)
    finally:
        sock.close()


def inherited_socket_holder(fd, original_pid, result_queue):
    # A forked process inherits the accepted socket but is NOT its connector.
    copied = socket.socket(fileno=fd)
    try:
        import struct
        reported_pid, _uid, _gid = struct.unpack('3i', copied.getsockopt(
            socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize('3i')))
        result_queue.put((reported_pid, os.getpid(), original_pid))
    finally:
        copied.close()


def denied(action, name):
    try:
        action()
    except (PermissionError, ValueError, ProcessLookupError, FileNotFoundError, OSError):
        return
    raise AssertionError('identity substitution accepted: ' + name)


with tempfile.TemporaryDirectory(prefix='ge04-sup11-') as temp:
    path = Path(temp) / 'role.sock'
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    listener.settimeout(8)
    try:
        listener.bind(str(path))
        listener.listen(2)
        ready, release = mp.Event(), mp.Event()
        proc = mp.Process(target=client, args=(path, ready, release))
        proc.start()
        assert ready.wait(5), 'client did not connect'
        try:
            conn, _ = listener.accept()
            with conn:
                exe, born = role.snapshot(proc.pid)
                assert role.inspect(conn, os.getuid(), proc.pid, exe, born) == 'ROLE_IDENTITY_OBSERVED_UNTRUSTED'
                denied(lambda: role.inspect(conn, os.getuid(), proc.pid + 1, exe, born), 'wrong PID')
                denied(lambda: role.inspect(conn, os.getuid() + 1, proc.pid, exe, born), 'wrong UID')
                denied(lambda: role.inspect(conn, os.getuid(), proc.pid, (exe[0], exe[1] + 1), born), 'wrong binary inode')
                denied(lambda: role.inspect(conn, os.getuid(), proc.pid, exe, born + 1), 'wrong process start ticks')
                denied(lambda: role.inspect(conn, os.getuid(), proc.pid, exe, True), 'boolean start ticks')
                # Cross-process descriptor inheritance does NOT change peer identity.
                # A different holder cannot be inferred from SO_PEERCRED alone.
                delegated_fd = os.dup(conn.fileno())
                result_queue = mp.Queue()
                inherited = mp.get_context('fork').Process(
                    target=inherited_socket_holder,
                    args=(delegated_fd, proc.pid, result_queue))
                inherited.start()
                os.close(delegated_fd)
                inherited.join(5)
                assert inherited.exitcode == 0, inherited.exitcode
                original, holder, expected = result_queue.get(timeout=3)
                assert original == expected == proc.pid and holder != original
            release.set()
            proc.join(8)
            assert proc.exitcode == 0, proc.exitcode
            # After termination a stale peer PID cannot be requalified.
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as after:
                denied(lambda: role.inspect(after, os.getuid(), proc.pid, exe, born), 'terminated original peer')
        finally:
            release.set()
            proc.join(8)
    finally:
        listener.close()

print('GE04 SUP-11 role identity observation PASS: kernel peer, binary, birth, stale and socket delegation documented')
