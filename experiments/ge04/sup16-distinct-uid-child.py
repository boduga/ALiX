#!/usr/bin/env python3
"""SUP-16 fixture child: separate executable, no authority, no secret access."""
import array
import os
from pathlib import Path
import socket
import sys


def main():
    control_fd = int(sys.argv[1])
    protected_key = Path(sys.argv[2])
    socket_path = sys.argv[3]
    if os.geteuid() != 65534 or os.getegid() != 65534:
        raise AssertionError('fixture child did not drop credentials')
    try:
        protected_key.read_bytes()
    except PermissionError:
        pass
    else:
        raise AssertionError('cross-UID protected key unexpectedly readable')
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as direct:
        try:
            direct.connect(socket_path)
        except PermissionError:
            pass
        else:
            raise AssertionError('cross-UID direct connection unexpectedly accepted')
    with socket.socket(fileno=control_fd) as control:
        payload, ancillary, flags, _ = control.recvmsg(2048, socket.CMSG_SPACE(4))
        if flags & socket.MSG_CTRUNC or not payload or b'\n' in payload:
            raise AssertionError('invalid test descriptor handoff')
        received_fds = []
        for level, kind, raw in ancillary:
            if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                values = array.array('i')
                values.frombytes(raw[:len(raw) - len(raw) % values.itemsize])
                received_fds.extend(values)
        if len(received_fds) != 1:
            raise AssertionError('expected one delegated socket')
        with socket.socket(fileno=received_fds[0]) as delegated:
            delegated.sendall(payload + b'\n')


if __name__ == '__main__':
    main()
