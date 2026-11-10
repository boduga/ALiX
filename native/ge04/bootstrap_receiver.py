"""GE-04 read-only bootstrap FD receive boundary (qualification-only).

Validates kernel SO_PEERCRED, bounded SCM_RIGHTS payload, expected generation,
and sealed canonical bytes. Expected peer/nonce/FD identity MUST be held by
a separately protected bootstrap controller; this code does not create trust.
No production caller, privileges, ACK, signaling, cleanup, or retries.
"""
import array
import os
import select
import socket
import struct
import time
from types import MappingProxyType

from bootstrap_binding import read_sealed_bootstrap_binding

ACK = b"B"
MAXIMUM_WAIT = 3.0


def receive_bootstrap_descriptor(sock, expected_peer, expected_inode,
                                 expected_nonce, expected_attempt, timeout=3.0,
                                 inspect_generation=None):
    """One bounded receive, poison-on-error by closing this *owned* socket.

    Expected peer is (pid, uid, gid, startticks), never derived from sock.
    inspect_generation must be a separately supplied read-only observer:
    returns (pid, startticks) from kernel evidence, not sender-supplied bytes.
    This does not authenticate who supplied the expected values.
    """
    received = []
    try:
        if (type(sock) is not socket.socket
                or type(expected_peer) is not tuple or len(expected_peer) != 4
                or any(type(x) is not int for x in expected_peer)
                or not 2 <= expected_peer[0] <= 2**31 - 1
                or any(x < 0 for x in expected_peer[1:3])
                or expected_peer[3] <= 0
                or type(expected_inode) is not tuple or len(expected_inode) != 2
                or any(type(x) is not int or x <= 0 for x in expected_inode)
                or type(expected_nonce) is not str or len(expected_nonce) != 64
                or any(c not in "0123456789abcdef" for c in expected_nonce)
                or type(expected_attempt) is not int or expected_attempt <= 0
                or type(timeout) not in (float, int)
                or not 0 < timeout <= MAXIMUM_WAIT
                or inspect_generation is None or not callable(inspect_generation)):
            raise ValueError("Invalid protected handoff request")
        if sock.family != socket.AF_UNIX or sock.type & 0xf != socket.SOCK_SEQPACKET:
            raise ValueError("Handoff must use connected UNIX seqpacket socket")
        peer_raw = sock.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED,
                                   struct.calcsize("3i"))
        if len(peer_raw) != struct.calcsize("3i"):
            raise ValueError("Missing kernel peer credentials")
        pid, uid, gid = struct.unpack("3i", peer_raw)
        if (pid, uid, gid) != expected_peer[:3]:
            raise ValueError("Unexpected publisher peer")
        if inspect_generation(pid) != (pid, expected_peer[3]):
            raise ValueError("Publisher generation not pinned")
        deadline = time.monotonic() + timeout
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("Bootstrap receive budget exceeded")
        ready, _, _ = select.select([sock], [], [], remaining)
        if not ready:
            raise TimeoutError("Bootstrap receive deadline")
        payload, ancillary, flags, _ = sock.recvmsg(
            2, socket.CMSG_SPACE(4 * 16), socket.MSG_CMSG_CLOEXEC)
        # Always first extract *all* kernel-delivered descriptors for closure,
        # including rejected extra or truncated ancillary records.
        for level, kind, data in ancillary:
            if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                valid = len(data) - (len(data) % array.array("i").itemsize)
                chunk = array.array("i")
                chunk.frombytes(data[:valid])
                received.extend(chunk)
        if (flags & (socket.MSG_CTRUNC | socket.MSG_TRUNC)
                or payload != ACK or len(ancillary) != 1 or len(received) != 1
                or time.monotonic() > deadline):
            raise ValueError("Malformed or ambiguous FD handoff")
        observation = read_sealed_bootstrap_binding(
            received[0], expected_uid=uid, expected_gid=gid,
            expected_inode=expected_inode)
        record = observation["record"]
        if (record["nonce"] != expected_nonce
                or record["attempt"] != expected_attempt
                or record["keeperPid"] != pid
                or record["keeperTicks"] != expected_peer[3]):
            raise ValueError("Sealed record contradicts kernel peer/binding")
        if inspect_generation(pid) != (pid, expected_peer[3]):
            raise ValueError("Publisher generation changed")
        return MappingProxyType({
            "status": "UNQUALIFIED_KERNEL_PEER_HANDOFF",
            "binding": observation,
            "peer": expected_peer,
        })
    finally:
        for fd in received:
            try:
                os.close(fd)
            except OSError:
                pass
        if isinstance(sock, socket.socket):
            sock.close()
