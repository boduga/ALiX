#!/usr/bin/env python3
"""GE-04 inert supervisor qualification harness (NOT a production service).

The executable entrypoint refuses to start. Tests may import and instantiate
this single-request Unix SOCK_SEQPACKET listener. It never mutates filesystem
targets or returns successful authorization. No caller-provided trust root.
"""
from __future__ import annotations

import os
import socket
import stat
import struct
import sys
from pathlib import Path

DENIED = b"DENIED GE04_UNAVAILABLE\n"
MAX_FRAME = 4096


class TrustError(RuntimeError):
    pass


def kernel_peer(sock: socket.socket) -> tuple[int, int, int]:
    """Linux kernel credentials, not caller-supplied claims or message JSON."""
    if sys.platform != "linux" or not hasattr(socket, "SO_PEERCRED"):
        raise TrustError("SO_PEERCRED required")
    data = sock.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12)
    if len(data) != 12:
        raise TrustError("Invalid kernel credential length")
    pid, uid, gid = struct.unpack("3i", data)
    if pid <= 0 or uid < 0 or gid < 0:
        raise TrustError("Invalid kernel credentials")
    return pid, uid, gid


def pinned_peer_matches(peer: tuple[int, int, int], expected_uid: int,
                        supervisor_uid: int) -> bool:
    return peer[0] > 0 and peer[1] == expected_uid and expected_uid >= 0 and (
        supervisor_uid >= 0 and supervisor_uid != expected_uid
    )


def trusted_install_preflight(path: Path) -> None:
    """Necessary preflight only; cannot establish race-free independent custody."""
    if not path.is_absolute():
        raise TrustError("Trust config must be absolute")
    for part in (Path("/"), *reversed(path.parent.parents), path.parent, path):
        info = os.lstat(part)
        if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise TrustError(f"Untrusted trust path component: {part}")
    if not stat.S_ISREG(os.lstat(path).st_mode):
        raise TrustError("Trust config must be a regular file")


class InertSupervisor:
    """Only for disposable test fixtures; never grants authority or writes files."""

    def __init__(self, path: Path, expected_uid: int, supervisor_uid: int):
        if sys.platform != "linux":
            raise TrustError("Linux required")
        self.path = path
        self.expected_uid = expected_uid
        self.supervisor_uid = supervisor_uid
        self.listener: socket.socket | None = None
        self.identity: tuple[int, int] | None = None

    def start(self) -> None:
        parent = os.lstat(self.path.parent)
        if not stat.S_ISDIR(parent.st_mode) or parent.st_mode & 0o077 or (
            parent.st_uid != os.geteuid()
        ):
            raise TrustError("Socket directory must be private and owned by supervisor")
        if self.path.exists() or self.path.is_symlink():
            raise TrustError("Socket path already exists")
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_SEQPACKET)
        try:
            listener.bind(str(self.path))
            os.chmod(self.path, 0o600)
            info = os.lstat(self.path)
            if not stat.S_ISSOCK(info.st_mode):
                raise TrustError("Socket path not a socket")
            self.identity = (info.st_dev, info.st_ino)
            listener.listen(1)
            listener.settimeout(3)
            self.listener = listener
        except BaseException:
            listener.close()
            self.close()
            raise

    def serve_once(self) -> bool:
        if self.listener is None:
            raise TrustError("Listener not started")
        connection, _ = self.listener.accept()
        with connection:
            connection.settimeout(2)
            allowed_identity = False
            try:
                peer = kernel_peer(connection)
                allowed_identity = pinned_peer_matches(
                    peer, self.expected_uid, self.supervisor_uid
                )
                data, ancillary, flags, _ = connection.recvmsg(
                    MAX_FRAME + 1, socket.CMSG_SPACE(256),
                    getattr(socket, "MSG_CMSG_CLOEXEC", 0)
                )
                for level, ctype, payload in ancillary:
                    if level == socket.SOL_SOCKET and ctype == socket.SCM_RIGHTS:
                        count = len(payload) // 4
                        for fd in struct.unpack(f"{count}i", payload[:count * 4]):
                            os.close(fd)
                if ancillary or flags & (socket.MSG_TRUNC | socket.MSG_CTRUNC) or (
                    not data or len(data) > MAX_FRAME
                ):
                    allowed_identity = False
            except (OSError, TrustError):
                allowed_identity = False
            try:
                connection.sendall(DENIED)
            except OSError:
                pass
            # This boolean records only whether credential checks passed,
            # NEVER whether any mutation was authorized.
            return allowed_identity

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
    # No externally installed, authenticated supervisor service exists yet.
    print("GE-04 SECURITY HOLD: inert supervisor not deployable", file=sys.stderr)
    return 78


if __name__ == "__main__":
    raise SystemExit(main())
