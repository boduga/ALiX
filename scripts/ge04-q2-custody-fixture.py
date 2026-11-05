#!/usr/bin/env python3
"""GE-04 Q2 transport custody fixture — ALWAYS DENY, NEVER DEPLOY.

No trust key, file mutation, approval, activation, or installed service.
The fixture demonstrates a traversable group socket directory (0710)
and group-connectable Unix seqpacket socket (0660), which PR4's private
0700/0600 directory did not allow for a distinct coordinator UID.

Passing peer credential checks is NOT authorization. A connected FD may
be delegated; SO_PEERCRED identifies the original connecting process.
"""
from __future__ import annotations

import os
import socket
import stat
import struct
import sys
from pathlib import Path

DENIED = b"DENIED GE04_SECURITY_HOLD\n"
MAX_FRAME = 4096


class CustodyError(RuntimeError):
    pass


def valid_peer(peer: tuple[int, int, int], coordinator_uid: int,
               supervisor_uid: int) -> bool:
    """Only kernel-supplied peer creds may be passed by the listener."""
    pid, uid, gid = peer
    return (pid > 0 and uid >= 0 and gid >= 0
            and coordinator_uid >= 0 and supervisor_uid >= 0
            and uid == coordinator_uid and coordinator_uid != supervisor_uid)


def peer_credentials(conn: socket.socket) -> tuple[int, int, int]:
    if sys.platform != "linux" or not hasattr(socket, "SO_PEERCRED"):
        raise CustodyError("SO_PEERCRED unavailable")
    raw = conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12)
    if len(raw) != 12:
        raise CustodyError("Invalid kernel credentials")
    return struct.unpack("3i", raw)


class DenyOnlyCustodyFixture:
    """Not an installable supervisor. Only usable by explicitly imported tests."""

    def __init__(self, parent: Path, coordinator_uid: int,
                 supervisor_uid: int, expected_group: int):
        self.parent = parent
        self.path = parent / "deny-only.sock"
        self.coordinator_uid = coordinator_uid
        self.supervisor_uid = supervisor_uid
        self.expected_group = expected_group
        self.listener: socket.socket | None = None
        self.identity: tuple[int, int] | None = None

    def start(self) -> None:
        if sys.platform != "linux":
            raise CustodyError("Linux required")
        parent = os.lstat(self.parent)
        if (not stat.S_ISDIR(parent.st_mode)
                or stat.S_ISLNK(parent.st_mode)
                or parent.st_uid != os.geteuid()
                or parent.st_gid != self.expected_group
                or stat.S_IMODE(parent.st_mode) != 0o710):
            raise CustodyError("Fixture directory needs owner-controlled 0710 with pinned group")
        if self.path.exists() or self.path.is_symlink():
            raise CustodyError("Refusing pre-existing socket or symlink")
        if self.coordinator_uid < 0 or self.supervisor_uid < 0:
            raise CustodyError("Invalid UID")
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_SEQPACKET)
        try:
            sock.bind(str(self.path))
            os.chmod(self.path, 0o660)
            info = os.lstat(self.path)
            if (not stat.S_ISSOCK(info.st_mode)
                    or info.st_uid != os.geteuid()
                    or info.st_gid != self.expected_group
                    or stat.S_IMODE(info.st_mode) != 0o660):
                raise CustodyError("Socket custody attributes invalid")
            self.identity = (info.st_dev, info.st_ino)
            sock.listen(1)
            sock.settimeout(4)
            self.listener = sock
        except BaseException:
            sock.close()
            self.close()
            raise

    def serve_once(self) -> bool:
        if self.listener is None:
            raise CustodyError("Not started")
        conn, _ = self.listener.accept()
        with conn:
            conn.settimeout(3)
            creds_match = False
            try:
                peer = peer_credentials(conn)
                creds_match = valid_peer(
                    peer, self.coordinator_uid, self.supervisor_uid
                )
                data, ancillary, flags, _ = conn.recvmsg(
                    MAX_FRAME + 1, socket.CMSG_SPACE(256),
                    getattr(socket, "MSG_CMSG_CLOEXEC", 0)
                )
                # Dispose of unexpected transferred descriptors, even when
                # rejecting, to avoid FD leakage in long-lived processes.
                for level, kind, payload in ancillary:
                    if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                        count = len(payload) // struct.calcsize("i")
                        for fd in struct.unpack(
                            f"{count}i",
                            payload[:count * struct.calcsize("i")]
                        ):
                            os.close(fd)
                if (not data or len(data) > MAX_FRAME
                        or ancillary or flags & (socket.MSG_TRUNC | socket.MSG_CTRUNC)):
                    creds_match = False
            except (OSError, CustodyError, struct.error):
                creds_match = False
            try:
                conn.sendall(DENIED)
            except OSError:
                pass
            return creds_match  # Diagnostic only, NEVER an authorization token.

    def close(self) -> None:
        if self.listener is not None:
            self.listener.close()
            self.listener = None
        try:
            info = os.lstat(self.path)
            if self.identity == (info.st_dev, info.st_ino):
                os.unlink(self.path)
        except FileNotFoundError:
            pass


def main() -> int:
    print("GE-04 SECURITY HOLD: Q2 custody fixture is not deployable", file=sys.stderr)
    return 78


if __name__ == "__main__":
    raise SystemExit(main())
