#!/usr/bin/env python3
"""GE04 SUP-11 Linux peer role identity observation; NEVER authorization.

The executable inode and start-time pins are provided by the test harness.
A /proc observation cannot prove coordinator role, signing authority, or safety
against privileged/same-UID attackers and process identity races.
"""
import os
from pathlib import Path
import socket
import stat
import struct
import sys


def _start_ticks(pid):
    # /proc/PID/stat comm is parenthesized and may contain spaces or ')'.
    raw = Path('/proc') / str(pid) / 'stat'
    value = raw.read_text()
    end = value.rfind(')')
    if end < 0:
        raise ValueError('malformed process stat')
    parts = value[end + 2:].split()
    if len(parts) < 20:
        raise ValueError('short process stat')
    return int(parts[19])  # original kernel field 22


def _exe_identity(pid):
    fd = os.open(f'/proc/{pid}/exe', os.O_RDONLY | os.O_CLOEXEC)
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode):
            raise PermissionError('peer executable is not regular')
        return st.st_dev, st.st_ino
    finally:
        os.close(fd)


def snapshot(pid):
    """Trusted provisioner would have to pin these out of band."""
    if type(pid) is not int or pid <= 0:
        raise ValueError('invalid PID')
    first = _start_ticks(pid)
    identity = _exe_identity(pid)
    if _start_ticks(pid) != first:
        raise PermissionError('process changed during inspection')
    return identity, first


def inspect(conn: socket.socket, expected_uid: int, expected_pid: int,
            expected_exe: tuple, expected_start: int):
    if sys.platform != 'linux' or not hasattr(socket, 'SO_PEERCRED') or not hasattr(os, 'pidfd_open'):
        raise RuntimeError('Linux SO_PEERCRED and pidfd required')
    if (type(expected_uid) is not int or type(expected_pid) is not int or
            expected_uid < 0 or expected_pid <= 0 or
            type(expected_exe) is not tuple or len(expected_exe) != 2 or
            any(type(x) is not int or x < 0 for x in expected_exe) or
            type(expected_start) is not int or expected_start <= 0):
        raise ValueError('missing pinned fixture identity')
    pid, uid, _gid = struct.unpack('3i', conn.getsockopt(
        socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize('3i')))
    if pid != expected_pid or uid != expected_uid:
        raise PermissionError('kernel peer credentials differ')
    # Opening a pidfd after SO_PEERCRED is not atomic with connection creation.
    # Bracketing proc stat and comparing pinned start ticks is defense in depth.
    before = _start_ticks(pid)
    handle = os.pidfd_open(pid, 0)
    try:
        if (_exe_identity(pid) != expected_exe or before != expected_start or
                _start_ticks(pid) != before):
            raise PermissionError('peer executable or process birth mismatch')
        # pidfd prevents PID reuse for this *opened handle*, not retroactively.
        # A passed/duplicated connected socket still carries the original peer.
        return 'ROLE_IDENTITY_OBSERVED_UNTRUSTED'
    finally:
        os.close(handle)
