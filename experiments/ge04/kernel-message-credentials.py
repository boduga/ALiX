#!/usr/bin/env python3
"""SUP-20 inert Linux datagram per-message kernel credentials gate.

A received SCM_CREDENTIALS is kernel-attested only when SO_PASSCRED is
enabled on the receiving socket. Never use SO_PEERCRED as a message sender
identity after descriptor delegation. This gate does not authorize mutations.
"""
import array
import os
import socket
import struct

CRED_FORMAT = '3i'
CRED_SIZE = struct.calcsize(CRED_FORMAT)
MAX_FRAME = 2048


def receive_inert_message(receiver, allowed_uid, allowed_pid=None):
    if receiver.family != socket.AF_UNIX or receiver.type & socket.SOCK_DGRAM != socket.SOCK_DGRAM:
        raise ValueError('AF_UNIX datagram required')
    if receiver.getsockopt(socket.SOL_SOCKET, socket.SO_PASSCRED) != 1:
        raise PermissionError('kernel sender credentials not enabled')
    payload, ancillary, flags, _ = receiver.recvmsg(
        MAX_FRAME + 1, socket.CMSG_SPACE(CRED_SIZE) +
        socket.CMSG_SPACE(8 * array.array('i').itemsize),
        getattr(socket, 'MSG_CMSG_CLOEXEC', 0))
    creds = []
    received_fds = []
    try:
        for level, kind, data in ancillary:
            if level == socket.SOL_SOCKET and kind == socket.SCM_CREDENTIALS:
                if len(data) != CRED_SIZE:
                    raise PermissionError('invalid credential record')
                creds.append(struct.unpack(CRED_FORMAT, data))
            elif level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                fds = array.array('i')
                fds.frombytes(data[:len(data) - len(data) % fds.itemsize])
                received_fds.extend(fds)
            else:
                raise PermissionError('unexpected ancillary record')
        if (flags & (socket.MSG_TRUNC | socket.MSG_CTRUNC) or
                not 0 < len(payload) <= MAX_FRAME or
                len(creds) != 1 or received_fds):
            raise PermissionError('invalid inert datagram or delegated descriptor')
        pid, uid, _gid = creds[0]
        if uid != allowed_uid or (allowed_pid is not None and pid != allowed_pid):
            raise PermissionError('kernel message sender is not the permitted fixture identity')
        return payload
    finally:
        for fd in received_fds:
            os.close(fd)
