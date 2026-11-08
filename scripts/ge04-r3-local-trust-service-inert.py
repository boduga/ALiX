"""GE-04 R3-TPM3 local trust transport qualification, deliberately inert.

Test-only AF_UNIX SOCK_SEQPACKET listener. No privileged service, no TPM I/O,
no signer, no checkpoint write, no policy/worker/recovery authorization.
Kernel SO_PEERCRED is diagnostic; an asserted UID or in-memory replay set
cannot prove independently provisioned authority or crash-safe nonce custody.
The executable entrypoint refuses deployment.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import socket
import stat
import struct
import sys

MAX_FRAME = 4096
MAX_ANCILLARY = socket.CMSG_SPACE(256)
DENIED = b'{"status":"blocked","securityHoldActive":true,"authorizationGranted":false}\n'
ALLOWED_OPERATIONS = frozenset(("status.read", "nv.inspect.metadata"))
REQUEST_KEYS = frozenset(("schema", "operation", "requestId", "nonce"))


class TrustServiceError(RuntimeError):
    pass


def kernel_peer(connection: socket.socket) -> tuple[int, int, int]:
    if (sys.platform != "linux" or not hasattr(socket, "SO_PEERCRED")
            or connection.family != socket.AF_UNIX):
        raise TrustServiceError("Linux peer credentials unavailable")
    data = connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED,
                                 struct.calcsize("3i"))
    if len(data) != struct.calcsize("3i"):
        raise TrustServiceError("short peer credentials")
    pid, uid, gid = struct.unpack("3i", data)
    if pid <= 1 or uid < 0 or gid < 0:
        raise TrustServiceError("invalid kernel identity")
    return pid, uid, gid


def strict_json(raw: bytes):
    def unique(pairs):
        result = {}
        for name, value in pairs:
            if name in result:
                raise ValueError("duplicate field")
            result[name] = value
        return result

    if not raw or len(raw) > MAX_FRAME or not raw.isascii():
        raise ValueError("invalid bounded ASCII request")
    message = json.loads(raw.decode("ascii"), object_pairs_hook=unique,
                         parse_constant=lambda _: (_ for _ in ()).throw(
                             ValueError("nonfinite JSON")))
    if type(message) is not dict or set(message) != REQUEST_KEYS:
        raise ValueError("invalid request shape")
    if message["schema"] != "ge04-r3-tpm3-inert-v1":
        raise ValueError("unsupported schema")
    if message["operation"] not in ALLOWED_OPERATIONS:
        raise ValueError("no mutation or privileged operations")
    for field, length in (("requestId", 128), ("nonce", 64)):
        item = message[field]
        if type(item) is not str or not 1 <= len(item) <= length or not all(
                c.isascii() and (c.isalnum() or c in "-_:") for c in item):
            raise ValueError("invalid request identity")
    if len(message["nonce"]) != 64 or any(c not in "0123456789abcdef"
                                          for c in message["nonce"]):
        raise ValueError("invalid nonce")
    return message


class InertLocalTrustService:
    """Disposable same-UID test transport; never grants or installs anything."""

    def __init__(self, path: Path, *, expected_client_uid: int):
        self.path = path
        self.expected_client_uid = expected_client_uid
        self.listener: socket.socket | None = None
        self.identity: tuple[int, int] | None = None
        self.seen: set[tuple[int, str, str]] = set()

    def start(self):
        if sys.platform != "linux" or not hasattr(socket, "SO_PEERCRED"):
            raise TrustServiceError("Linux kernel peer credentials required")
        if (type(self.expected_client_uid) is not int
                or self.expected_client_uid < 0
                or not self.path.is_absolute()):
            raise TrustServiceError("invalid fixture identity or socket path")
        parent = os.lstat(self.path.parent)
        if (not stat.S_ISDIR(parent.st_mode)
                or parent.st_uid != os.geteuid()
                or stat.S_IMODE(parent.st_mode) != 0o700):
            raise TrustServiceError("test socket directory must be private")
        if os.path.lexists(self.path):
            raise TrustServiceError("existing socket path cannot be replaced")
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_SEQPACKET)
        try:
            listener.bind(str(self.path))
            os.chmod(self.path, 0o600)
            node = os.lstat(self.path)
            if (not stat.S_ISSOCK(node.st_mode)
                    or node.st_uid != os.geteuid()
                    or stat.S_IMODE(node.st_mode) != 0o600):
                raise TrustServiceError("untrusted bound fixture socket")
            self.identity = (node.st_dev, node.st_ino)
            listener.listen(2)
            listener.settimeout(3)
            self.listener = listener
        except BaseException:
            listener.close()
            self.close()
            raise

    def serve_once(self) -> dict:
        if self.listener is None:
            raise TrustServiceError("listener not started")
        conn, _ = self.listener.accept()
        result = {"status": "blocked", "peerConsistent": False,
                  "requestConsistent": False, "replay": False,
                  "authorizationGranted": False, "securityHoldActive": True}
        with conn:
            conn.settimeout(2)
            try:
                pid, uid, gid = kernel_peer(conn)
                result["peerConsistent"] = uid == self.expected_client_uid
                raw, ancillary, flags, _ = conn.recvmsg(
                    MAX_FRAME + 1, MAX_ANCILLARY,
                    getattr(socket, "MSG_CMSG_CLOEXEC", 0))
                # Close any descriptors supplied by an untrusted caller.
                for level, kind, payload in ancillary:
                    if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                        width = struct.calcsize("i")
                        for index in range(0, len(payload) - width + 1, width):
                            fd = struct.unpack("i", payload[index:index+width])[0]
                            os.close(fd)
                if (ancillary or flags & (socket.MSG_TRUNC | socket.MSG_CTRUNC)
                        or len(raw) > MAX_FRAME):
                    raise ValueError("ancillary or oversized input denied")
                request = strict_json(raw)
                if not result["peerConsistent"]:
                    raise ValueError("unexpected peer UID")
                key = (uid, request["requestId"], request["nonce"])
                if key in self.seen:
                    result["replay"] = True
                    raise ValueError("replayed test request")
                self.seen.add(key)
                result["requestConsistent"] = True
            except (ValueError, TypeError, OSError, TrustServiceError,
                    UnicodeError, json.JSONDecodeError):
                pass
            try:
                conn.sendall(DENIED)
            except OSError:
                pass
        # Even a fully consistent request has no privilege to act.
        return result

    def close(self):
        if self.listener is not None:
            self.listener.close()
            self.listener = None
        try:
            node = os.lstat(self.path)
            if self.identity == (node.st_dev, node.st_ino):
                os.unlink(self.path)
        except FileNotFoundError:
            pass

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, *_):
        self.close()


def main():
    print("GE-04 SECURITY HOLD: inert local trust service is not deployable",
          file=sys.stderr)
    return 78


if __name__ == "__main__":
    raise SystemExit(main())
