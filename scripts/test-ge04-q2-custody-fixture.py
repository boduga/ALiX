#!/usr/bin/env python3
"""Q2 nonprivileged independent-PROCESS negative IPC qualification.

IMPORTANT: processes share the same UID in this suite. The cross-UID
deployment proof remains untested until run by an independent operator
with separately administered identities. All responses are DENIED.
"""
import importlib.util
import multiprocessing
import os
from pathlib import Path
import socket
import struct
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("ge04-q2-custody-fixture.py")
spec = importlib.util.spec_from_file_location("ge04_q2_custody", SCRIPT)
assert spec and spec.loader
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)


def serve(root: str, coordinator_uid: int, supervisor_uid: int,
          group: int, ready, verdict):
    fixture = mod.DenyOnlyCustodyFixture(Path(root), coordinator_uid, supervisor_uid, group)
    try:
        fixture.start()
        ready.send(("ready", os.getpid()))
        verdict.send(fixture.serve_once())
    except BaseException as err:
        ready.send(("error", str(err)))
    finally:
        fixture.close()
        ready.close()
        verdict.close()


@unittest.skipUnless(sys.platform == "linux", "Linux AF_UNIX SO_PEERCRED")
class Q2CustodyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="alix-ge04-q2-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        os.chmod(self.root, 0o710)
        self.sock = self.root / "deny-only.sock"

    def exchange(self, expected_uid, supervisor_uid, *,
                 data=b'{"approved":true,"uid":0}', ancillary=None):
        # Child is an independent process but with the SAME UID as its
        # parent. This never qualifies actual distinct-UID custody.
        mp = multiprocessing.get_context("fork")
        rx_ready, tx_ready = mp.Pipe(duplex=False)
        rx_result, tx_result = mp.Pipe(duplex=False)
        child = mp.Process(
            target=serve, args=(str(self.root), expected_uid,
                                supervisor_uid, os.getgid(), tx_ready, tx_result)
        )
        child.start()
        tx_ready.close()
        tx_result.close()
        try:
            self.assertTrue(rx_ready.poll(4), "listener must report readiness")
            state, pid = rx_ready.recv()
            self.assertEqual(state, "ready", pid)
            self.assertNotEqual(pid, os.getpid())
            info = os.lstat(self.sock)
            self.assertEqual(info.st_mode & 0o777, 0o660)
            self.assertEqual(os.lstat(self.root).st_mode & 0o777, 0o710)
            with socket.socket(socket.AF_UNIX, socket.SOCK_SEQPACKET) as client:
                client.settimeout(3)
                client.connect(str(self.sock))
                if ancillary is None:
                    client.sendall(data)
                else:
                    client.sendmsg([data], ancillary)
                response = client.recv(128)
            self.assertEqual(response, mod.DENIED)
            self.assertTrue(rx_result.poll(4), "listener must return diagnostic")
            verdict = rx_result.recv()
            return verdict
        finally:
            child.join(5)
            if child.is_alive():
                child.terminate()
                child.join(5)
            rx_ready.close()
            rx_result.close()
            self.assertEqual(child.exitcode, 0)
            self.assertFalse(self.sock.exists())

    def test_distinct_process_same_uid_does_not_qualify_as_supervisor(self):
        self.assertFalse(self.exchange(os.getuid(), os.getuid()))

    def test_wrong_actual_peer_uid_denied_even_if_json_forges_identity(self):
        self.assertFalse(self.exchange(os.getuid() + 123, os.getuid() + 124))

    def test_peer_creds_match_diagnostic_still_always_denied(self):
        self.assertTrue(self.exchange(os.getuid(), os.getuid() + 1))

    def test_oversized_frame_denied(self):
        self.assertFalse(self.exchange(os.getuid(), os.getuid() + 1,
                                       data=b"A" * (mod.MAX_FRAME + 100)))

    def test_transferred_fd_denied_and_listener_closes_received_copy(self):
        r, w = os.pipe()
        try:
            self.assertFalse(self.exchange(
                os.getuid(), os.getuid() + 1,
                ancillary=[(socket.SOL_SOCKET, socket.SCM_RIGHTS, struct.pack("i", r))]
            ))
        finally:
            os.close(r)
            os.close(w)

    def test_socket_directory_not_traversable_for_group_is_rejected(self):
        os.chmod(self.root, 0o700)
        with self.assertRaises(mod.CustodyError):
            mod.DenyOnlyCustodyFixture(
                self.root, os.getuid(), os.getuid() + 1, os.getgid()
            ).start()

    def test_public_directory_is_rejected(self):
        os.chmod(self.root, 0o755)
        with self.assertRaises(mod.CustodyError):
            mod.DenyOnlyCustodyFixture(
                self.root, os.getuid(), os.getuid() + 1, os.getgid()
            ).start()

    def test_preexisting_socket_path_cannot_be_replaced(self):
        self.sock.write_text("must not be replaced", encoding="utf-8")
        with self.assertRaises(mod.CustodyError):
            mod.DenyOnlyCustodyFixture(
                self.root, os.getuid(), os.getuid() + 1, os.getgid()
            ).start()
        self.assertEqual(self.sock.read_text(), "must not be replaced")

    def test_symlink_socket_path_is_rejected(self):
        self.sock.symlink_to(self.root / "target")
        with self.assertRaises(mod.CustodyError):
            mod.DenyOnlyCustodyFixture(
                self.root, os.getuid(), os.getuid() + 1, os.getgid()
            ).start()

    def test_kernel_identity_requires_different_supervisor_uid(self):
        self.assertFalse(mod.valid_peer((123, 1000, 1000), 1000, 1000))
        self.assertTrue(mod.valid_peer((123, 1000, 1000), 1000, 1001))
        self.assertFalse(mod.valid_peer((123, 1000, 1000), 1001, 1002))
        self.assertFalse(mod.valid_peer((-1, 1000, 1000), 1000, 1001))


class EntrypointTests(unittest.TestCase):
    def test_fixture_executable_is_always_disabled(self):
        run = subprocess.run([sys.executable, str(SCRIPT)], capture_output=True,
                             text=True, timeout=5)
        self.assertEqual(run.returncode, 78)
        self.assertIn("SECURITY HOLD", run.stderr)


if __name__ == "__main__":
    unittest.main()
