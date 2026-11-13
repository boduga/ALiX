"""GE-04 kernel peer FD-handoff contract tests. No privileged publisher."""
import array
try:
    import fcntl
except ImportError:
    fcntl = None
import importlib.util
import json
import os
from pathlib import Path
import socket
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2] / "native/ge04"
SUPPORTED = (sys.platform == "linux" and fcntl is not None
             and hasattr(socket, "SO_PEERCRED")
             and hasattr(socket, "MSG_CMSG_CLOEXEC")
             and hasattr(os, "memfd_create") and hasattr(fcntl, "F_GET_SEALS"))
binding = receiver = None
if SUPPORTED:
    sys.path.insert(0, str(ROOT))
    import bootstrap_binding as binding
    import bootstrap_receiver as receiver


def source_record(attempt=1, nonce="b" * 64):
    content = dict(schemaVersion=1,
                   unit="ge04-r1b2-view-qualification.service",
                   invocation="a" * 32, keeperPid=os.getpid(),
                   keeperTicks=generation()[1], mountId=39,
                   mountDevice="0:29", mountRoot="/",
                   ancestry=[[1, 15], [1, 16], [1, 17]],
                   attempt=attempt, nonce=nonce,
                   sourceSha256="c" * 64, controllerSha256="d" * 64)
    return (json.dumps(content, sort_keys=True, separators=(",", ":"))
            + "\n").encode()


def generation():
    raw = Path("/proc/self/stat").read_bytes()
    fields = raw[raw.rfind(b") ") + 2:].strip().split(b" ")
    return os.getpid(), int(fields[19])


def sealed_fd(raw=None):
    fd = os.memfd_create("ge04-peer-test", os.MFD_CLOEXEC | os.MFD_ALLOW_SEALING)
    os.write(fd, source_record() if raw is None else raw)
    fcntl.fcntl(fd, fcntl.F_ADD_SEALS, binding.SEALS)
    return fd


def exercise(fd_count=1, data=b"B", attempt=1, nonce="b" * 64,
             expected=None, observer=None):
    left, right = socket.socketpair(socket.AF_UNIX, socket.SOCK_SEQPACKET)
    owned = [sealed_fd() for _ in range(fd_count)]
    identity = os.fstat(owned[0]) if owned else None
    try:
        rights = array.array("i", owned)
        right.sendmsg([data], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, rights)])
        if expected is None:
            expected = (os.getpid(), os.getuid(), os.getgid(), generation()[1])
        if observer is None:
            observer = lambda pid: generation()
        return receiver.receive_bootstrap_descriptor(
            left, expected, (identity.st_dev, identity.st_ino) if identity else (1, 1),
            nonce, attempt, inspect_generation=observer)
    finally:
        right.close()
        left.close()
        for fd in owned:
            os.close(fd)


@unittest.skipUnless(SUPPORTED, "Linux kernel peercred and sealed memfd required")
class BootstrapPeerReceiverTests(unittest.TestCase):
    def test_success_is_diagnostic_only(self):
        result = exercise()
        self.assertEqual(result["status"], "UNQUALIFIED_KERNEL_PEER_HANDOFF")
        self.assertEqual(result["peer"][0], os.getpid())
        self.assertEqual(result["binding"]["record"]["attempt"], 1)
        with self.assertRaises(TypeError):
            result["peer"] = ()
    def test_rejects_extra_fd_payload_and_wrong_fencing(self):
        cases = (
            dict(fd_count=2), dict(data=b"XX"), dict(data=b""),
            dict(nonce="a" * 64), dict(attempt=2),
            dict(expected=(os.getpid() + 1, os.getuid(), os.getgid(),
                           generation()[1])),
            dict(expected=(os.getpid(), os.getuid() + 1, os.getgid(),
                           generation()[1])),
            dict(expected=(os.getpid(), os.getuid(), os.getgid(),
                           generation()[1] + 1)),
            dict(observer=lambda pid: (pid, generation()[1] + 1)),
        )
        for case in cases:
            with self.subTest(case=case), self.assertRaises((ValueError, OSError)):
                exercise(**case)
    def test_invalid_request_closes_owned_socket_without_receive(self):
        left, right = socket.socketpair(socket.AF_UNIX, socket.SOCK_SEQPACKET)
        try:
            with self.assertRaises(ValueError):
                receiver.receive_bootstrap_descriptor(
                    left, (os.getpid(), os.getuid(), os.getgid(), generation()[1]),
                    (1, 1), "not-a-valid-nonce", 1,
                    inspect_generation=lambda pid: generation())
            self.assertEqual(left.fileno(), -1)
        finally:
            right.close()

    def test_readiness_race_never_blocks_on_recvmsg(self):
        # Simulate readiness consumed by another actor before recvmsg.
        # A blocking recvmsg would hang indefinitely despite the deadline.
        left, right = socket.socketpair(socket.AF_UNIX, socket.SOCK_SEQPACKET)
        try:
            with patch.object(receiver.select, "select", return_value=([left], [], [])):
                with self.assertRaises(BlockingIOError):
                    receiver.receive_bootstrap_descriptor(
                        left, (os.getpid(), os.getuid(), os.getgid(), generation()[1]),
                        (1, 1), "b" * 64, 1,
                        inspect_generation=lambda pid: generation())
            self.assertEqual(left.fileno(), -1)
        finally:
            right.close()

    def test_receive_timeout_and_closed_socket(self):
        left, right = socket.socketpair(socket.AF_UNIX, socket.SOCK_SEQPACKET)
        try:
            with self.assertRaises(TimeoutError):
                receiver.receive_bootstrap_descriptor(
                    left, (os.getpid(), os.getuid(), os.getgid(), generation()[1]),
                    (1, 1), "b" * 64, 1, timeout=0.01,
                    inspect_generation=lambda pid: generation())
            self.assertEqual(left.fileno(), -1)
        finally:
            right.close()
