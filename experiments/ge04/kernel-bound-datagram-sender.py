#!/usr/bin/env python3
"""GE-04 SUP-22b: per-message kernel-bound pidfd identity. Inert fixture only.

SO_PASSPIDFD delivers a sender pidfd with *the message*. A live provisioned
pidfd prevents accepting a recycled numeric PID: compare /proc/self/fdinfo
PID and NSpid projections while requiring the pinned process remain live.
PIDFD fstat inode is NOT unique and must never be used for comparison.
This is NOT atomic mutation authorization.
"""
import array
import os
import select
import socket
import struct
import sys

SO_PASSPIDFD = getattr(socket, 'SO_PASSPIDFD', 76)  # Linux asm-generic UAPI
SCM_PIDFD = getattr(socket, 'SCM_PIDFD', 4)  # Linux SOL_SOCKET UAPI
CRED_FMT = '3i'
CRED_LEN = struct.calcsize(CRED_FMT)
INT_LEN = struct.calcsize('i')
MAX_FRAME = 2048


def _pid_projection(fd):
    # Reads the kernel pidfd identity, not /proc/<numeric-pid>/stat.
    # These numbers are meaningful in this receiver's procfs namespace.
    with open(f'/proc/self/fdinfo/{fd}', encoding='ascii') as stream:
        entries = stream.read().splitlines()
    fields = {}
    for line in entries:
        if ':' in line:
            name, value = line.split(':', 1)
            if name in ('Pid', 'NSpid'):
                if name in fields:
                    raise PermissionError('duplicate pidfd identity field')
                fields[name] = value.strip()
    try:
        pid = int(fields['Pid'])
        ns_pids = tuple(int(x) for x in fields['NSpid'].split())
    except (KeyError, ValueError) as exc:
        raise PermissionError('pidfd identity unavailable') from exc
    if pid <= 0 or not ns_pids or ns_pids[0] != pid:
        raise PermissionError('pidfd exited or outside trusted procfs namespace')
    return pid, ns_pids


def _live(fd):
    watch = select.poll()
    watch.register(fd, select.POLLIN | select.POLLHUP | select.POLLERR)
    if watch.poll(0):
        raise PermissionError('pinned process no longer live')


class KernelPinnedSender:
    def __init__(self, pid, uid):
        if (sys.platform != 'linux' or not hasattr(os, 'pidfd_open') or
                type(pid) is not int or pid <= 0 or
                type(uid) is not int or uid < 0):
            raise ValueError('Linux pidfd and validated fixture sender required')
        self._fd = os.pidfd_open(pid, 0)
        self._uid = uid
        self._closed = False
        try:
            _live(self._fd)
            self._identity = _pid_projection(self._fd)
        except BaseException:
            self.close()
            raise

    def close(self):
        if not self._closed:
            self._closed = True
            os.close(self._fd)

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()

    def _verify_live(self):
        if self._closed:
            raise PermissionError('sender pin closed')
        _live(self._fd)

    def receive(self, receiver):
        self._verify_live()
        if (receiver.family != socket.AF_UNIX or
                receiver.type & socket.SOCK_DGRAM != socket.SOCK_DGRAM):
            raise ValueError('Unix datagram receiver required')
        # Both socket options must be explicitly enabled by the trusted
        # endpoint bootstrap, not implicitly enabled by an untrusted caller.
        if (receiver.getsockopt(socket.SOL_SOCKET, socket.SO_PASSCRED) != 1 or
                receiver.getsockopt(socket.SOL_SOCKET, SO_PASSPIDFD) != 1):
            raise PermissionError('kernel per-message credentials/pidfd not enabled')
        payload, ancillary, flags, _ = receiver.recvmsg(
            MAX_FRAME + 1,
            socket.CMSG_SPACE(CRED_LEN) +
            socket.CMSG_SPACE(INT_LEN) +
            socket.CMSG_SPACE(8 * array.array('i').itemsize),
            getattr(socket, 'MSG_CMSG_CLOEXEC', 0))
        credentials = []
        sender_pidfds = []
        rights_fds = []
        try:
            for level, kind, data in ancillary:
                if level != socket.SOL_SOCKET:
                    raise PermissionError('unrecognized ancillary level')
                if kind == socket.SCM_CREDENTIALS:
                    if len(data) != CRED_LEN:
                        raise PermissionError('invalid sender credentials')
                    credentials.append(struct.unpack(CRED_FMT, data))
                elif kind == SCM_PIDFD:
                    if len(data) != INT_LEN:
                        raise PermissionError('invalid sender pidfd')
                    sender_pidfds.append(struct.unpack('i', data)[0])
                elif kind == socket.SCM_RIGHTS:
                    fds = array.array('i')
                    fds.frombytes(data[:len(data) - len(data) % fds.itemsize])
                    rights_fds.extend(fds)
                else:
                    raise PermissionError('unexpected ancillary type')
            if (flags & (socket.MSG_TRUNC | socket.MSG_CTRUNC) or
                    not 0 < len(payload) <= MAX_FRAME or
                    len(credentials) != 1 or len(sender_pidfds) != 1 or
                    rights_fds):
                raise PermissionError('missing/truncated/unsafe datagram')
            _pid, uid, _gid = credentials[0]
            if uid != self._uid:
                raise PermissionError('sender UID mismatch')
            # A live pinned process keeps its PID occupied. A different
            # process cannot share its numeric identity while the pin is
            # still live; the postcheck rejects exit/reuse interleavings.
            if _pid_projection(sender_pidfds[0]) != self._identity:
                raise PermissionError('message sender pidfd does not match live pinned process')
            self._verify_live()
            return payload
        finally:
            # Every kernel-installed descriptor must be closed on all paths.
            for fd in sender_pidfds + rights_fds:
                os.close(fd)


def configure_receiver(sock):
    if sock.family != socket.AF_UNIX or sock.type & socket.SOCK_DGRAM != socket.SOCK_DGRAM:
        raise ValueError('Unix datagram receiver required')
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_PASSCRED, 1)
    # Unsupported kernels must throw OSError; no fallback to numeric PID.
    sock.setsockopt(socket.SOL_SOCKET, SO_PASSPIDFD, 1)
    if sock.getsockopt(socket.SOL_SOCKET, SO_PASSPIDFD) != 1:
        raise PermissionError('kernel pidfd delivery unavailable')
