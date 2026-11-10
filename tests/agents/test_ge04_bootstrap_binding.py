"""Unprivileged sealed descriptor transport tests; NEVER root qualification."""
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


SOURCE = Path(__file__).resolve().parents[2] / "native/ge04/bootstrap_binding.py"
SUPPORTED = (sys.platform == "linux" and fcntl is not None
             and hasattr(os, "memfd_create")
             and all(hasattr(fcntl, name) for name in
                     ("F_GET_SEALS", "F_ADD_SEALS", "F_SEAL_WRITE",
                      "F_SEAL_SHRINK", "F_SEAL_GROW", "F_SEAL_SEAL")))
binding = None
if SUPPORTED:
    spec = importlib.util.spec_from_file_location("ge04_bootstrap_binding", SOURCE)
    binding = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(binding)


def fixture(**changes):
    record = {
        "schemaVersion": 1,
        "unit": "ge04-r1b2-view-qualification.service",
        "invocation": "a" * 32,
        "keeperPid": 101,
        "keeperTicks": 123456,
        "mountId": 39,
        "mountDevice": "0:29",
        "mountRoot": "/",
        "ancestry": [[1, 15], [1, 16], [1, 17]],
        "attempt": 1,
        "nonce": "b" * 64,
        "sourceSha256": "c" * 64,
        "controllerSha256": "d" * 64,
    }
    record.update(changes)
    return (json.dumps(record, sort_keys=True, separators=(",", ":"))
            + "\n").encode("ascii")


def make_fd(raw, seal=True):
    fd = os.memfd_create("ge04-bootstrap-fixture",
                         os.MFD_CLOEXEC | os.MFD_ALLOW_SEALING)
    os.write(fd, raw)
    if seal:
        fcntl.fcntl(fd, fcntl.F_ADD_SEALS, binding.SEALS)
    return fd


@unittest.skipUnless(SUPPORTED, "Linux sealed-memfd contract only")
class SealedBootstrapBindingTests(unittest.TestCase):
    def test_canonical_read_is_immutable_and_not_authority(self):
        fd = make_fd(fixture())
        try:
            os.lseek(fd, 2, os.SEEK_SET)
            inode = os.fstat(fd)
            observed = binding.read_sealed_bootstrap_binding(
                fd, expected_uid=os.getuid(), expected_gid=os.getgid(), expected_inode=(inode.st_dev, inode.st_ino))
            self.assertEqual(os.lseek(fd, 0, os.SEEK_CUR), 2)
            self.assertEqual(observed["status"], "UNQUALIFIED_SEALED_BOOTSTRAP")
            self.assertEqual(observed["record"]["ancestry"],
                             ((1, 15), (1, 16), (1, 17)))
            with self.assertRaises(TypeError):
                observed["record"]["keeperPid"] = 102
            with self.assertRaises(PermissionError):
                os.write(fd, b"x")
            with self.assertRaises(ValueError):
                binding.read_sealed_bootstrap_binding(
                    fd, expected_uid=os.getuid(), expected_gid=os.getgid(), expected_inode=(inode.st_dev, inode.st_ino + 1))
            with self.assertRaises(ValueError):
                binding.read_sealed_bootstrap_binding(fd, expected_uid=os.getuid(), expected_gid=os.getgid() + 1)
        finally:
            os.close(fd)

    def test_unsealed_writable_and_regular_file_rejected(self):
        fd = make_fd(fixture(), seal=False)
        try:
            with self.assertRaises(ValueError):
                binding.read_sealed_bootstrap_binding(fd, expected_uid=os.getuid(), expected_gid=os.getgid())
        finally:
            os.close(fd)
        import tempfile
        with tempfile.TemporaryFile() as handle:
            handle.write(fixture())
            handle.flush()
            with self.assertRaises((ValueError, OSError)):
                binding.read_sealed_bootstrap_binding(
                    handle.fileno(), expected_uid=os.getuid(), expected_gid=os.getgid())

    def test_rejects_missing_extra_malformed_and_replay_claim_shapes(self):
        examples = (
            fixture(schemaVersion=True),
            fixture(unit="evil.service"),
            fixture(invocation="A" * 32),
            fixture(keeperPid=True),
            fixture(keeperTicks=0),
            fixture(mountRoot="/nested"),
            fixture(mountId=-1),
            fixture(ancestry=[[1, 2]]),
            fixture(ancestry=[[1, 2], [1, True], [1, 3]]),
            fixture(nonce="short"),
            fixture(sourceSha256="Z" * 64),
            fixture(attempt=0),
            fixture()[:-1],
            fixture().replace(b'"attempt":1', b'"attempt":1, "attempt":1'),
            b"{}\n", b"", b"x" * 4097,
        )
        for raw in examples:
            with self.subTest(raw=raw[:80]), self.assertRaises(ValueError):
                binding.parse_bootstrap_binding(raw)
        valid = fixture()
        for raw in (valid.replace(b'"attempt":1', b'"attempt": 1'),
                    valid.replace(b'"attempt":1', b'"attempt":1.0'),
                    valid.replace(b'"attempt":1', b'"attempt":NaN')):
            with self.subTest(raw=raw[:80]), self.assertRaises(ValueError):
                binding.parse_bootstrap_binding(raw)

    def test_fd_received_from_distinct_unprivileged_process(self):
        if not hasattr(os, "fork"):
            self.skipTest("fork unavailable")
        left, right = socket.socketpair(socket.AF_UNIX, socket.SOCK_SEQPACKET)
        child = os.fork()
        if child == 0:
            left.close()
            try:
                fd = make_fd(fixture())
                try:
                    rights = array.array("i", [fd])
                    right.sendmsg([b"B"], [(socket.SOL_SOCKET, socket.SCM_RIGHTS,
                                            rights.tobytes())])
                finally:
                    os.close(fd)
                os._exit(0)
            except BaseException:
                os._exit(85)
        right.close()
        left.settimeout(3)
        try:
            data, ancillary, flags, _ = left.recvmsg(1, socket.CMSG_SPACE(4))
            self.assertEqual(data, b"B")
            self.assertEqual(flags & socket.MSG_CTRUNC, 0)
            self.assertEqual(len(ancillary), 1)
            level, message_type, raw = ancillary[0]
            self.assertEqual((level, message_type),
                             (socket.SOL_SOCKET, socket.SCM_RIGHTS))
            received = array.array("i")
            received.frombytes(raw)
            self.assertEqual(len(received), 1)
            try:
                outcome = binding.read_sealed_bootstrap_binding(
                    received[0], expected_uid=os.getuid(), expected_gid=os.getgid())
                self.assertEqual(outcome["status"], "UNQUALIFIED_SEALED_BOOTSTRAP")
            finally:
                os.close(received[0])
        finally:
            left.close()
            _, status = os.waitpid(child, 0)
            self.assertTrue(os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0)
