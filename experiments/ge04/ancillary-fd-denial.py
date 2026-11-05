#!/usr/bin/env python3
"""SUP-18: inert AF_UNIX datagram control frame with deny-by-default ancillary data.

This is a test-only receiver, not an authority boundary. It prevents a
cooperating endpoint from retaining accidentally delegated SCM_RIGHTS FDs.
"""
import array
import os
import socket

MAX_CONTROL = 2048
MAX_HANDLES = 8


def receive_without_descriptors(conn):
    """Return a bounded inert byte frame, reject and close received FDs.

    SOCK_DGRAM boundary required. Other processes can still pass FDs through
    other endpoints; rejecting ancillary data on this one path is not global
    descriptor containment or proof of who sent the request.
    """
    if conn.family != socket.AF_UNIX or conn.type & socket.SOCK_DGRAM != socket.SOCK_DGRAM:
        raise ValueError('Unix datagram endpoint required')
    flags = getattr(socket, 'MSG_CMSG_CLOEXEC', 0)
    msg, ancillary, received_flags, _ = conn.recvmsg(
        MAX_CONTROL + 1, socket.CMSG_SPACE(MAX_HANDLES * array.array('i').itemsize),
        flags)
    received_fds = []
    try:
        for level, kind, raw in ancillary:
            if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                integers = array.array('i')
                integers.frombytes(raw[:len(raw) - len(raw) % integers.itemsize])
                received_fds.extend(integers)
        if (received_flags & (socket.MSG_TRUNC | socket.MSG_CTRUNC)
                or ancillary or not msg or len(msg) > MAX_CONTROL):
            raise PermissionError('untrusted or unbounded ancillary frame')
        return msg
    finally:
        for fd in received_fds:
            os.close(fd)
