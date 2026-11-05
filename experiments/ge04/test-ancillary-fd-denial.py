#!/usr/bin/env python3
"""SUP-18 inert descriptor-discard and exec-inheritance regression."""
import array
import importlib.util
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile

if sys.platform != 'linux':
    raise SystemExit('GE04 SUP-18 requires Linux')

spec = importlib.util.spec_from_file_location(
    'ge04_sup18', Path(__file__).with_name('ancillary-fd-denial.py'))
receiver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receiver)


def rejected(action):
    try:
        action()
    except (PermissionError, ValueError):
        return
    raise AssertionError('untrusted control frame accepted')


left, right = socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)
try:
    left.send(b'fixture-control')
    assert receiver.receive_without_descriptors(right) == b'fixture-control'

    # A real SCM_RIGHTS transfer MUST be rejected and the received fd closed.
    with tempfile.TemporaryFile() as f:
        prior = len(os.listdir('/proc/self/fd'))
        left.sendmsg([b'inert'], [(socket.SOL_SOCKET, socket.SCM_RIGHTS,
                                  array.array('i', [f.fileno()]))])
        rejected(lambda: receiver.receive_without_descriptors(right))
        assert len(os.listdir('/proc/self/fd')) == prior, 'received FD leaked'
        # Ancillary-buffer truncation also must fail without leaked FDs.
        left.sendmsg([b'inert'], [(socket.SOL_SOCKET, socket.SCM_RIGHTS,
                                  array.array('i', [f.fileno()] * 16))])
        rejected(lambda: receiver.receive_without_descriptors(right))
        assert len(os.listdir('/proc/self/fd')) == prior, 'truncated ancillary leaked'

    left.send(b'x' * 2049)
    rejected(lambda: receiver.receive_without_descriptors(right))
    left.send(b'')
    rejected(lambda: receiver.receive_without_descriptors(right))
    rejected(lambda: receiver.receive_without_descriptors(
        socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)))
finally:
    left.close()
    right.close()

# Verify an intentionally inheritable open descriptor is still omitted from
# a clean child exec when close_fds=True and pass_fds=() are both explicit.
with tempfile.TemporaryFile() as f:
    descriptor = f.fileno()
    os.set_inheritable(descriptor, True)
    own_target = os.readlink(f'/proc/self/fd/{descriptor}')
    child = subprocess.run(
        [sys.executable, '-B', '-c',
         "import os,sys; target=sys.argv[1]; "
         "paths=[os.readlink('/proc/self/fd/'+n) for n in os.listdir('/proc/self/fd') "
         "if os.path.exists('/proc/self/fd/'+n)]; "
         "sys.exit(2 if target in paths else 0)",
         own_target],
        close_fds=True, pass_fds=(), capture_output=True, timeout=6)
    assert child.returncode == 0, child.stderr
    # Do not accidentally leave an inheritable descriptor in test process.
    os.set_inheritable(descriptor, False)

print('GE04 SUP-18 ancillary containment PASS: received FD rejected and closed, oversized frame denied, exec inheritance excluded')
