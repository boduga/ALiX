"""GE-04-R2K real AF_UNIX accepted-socket credential tests."""
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

SOURCE = Path(__file__).resolve().parents[2] / "scripts/ge04-r2k-peercred-gate.py"
spec = importlib.util.spec_from_file_location("ge04_r2k", SOURCE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class PeerCredTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="ge04-r2k-")
        self.addCleanup(self.temp.cleanup)
        path = str(Path(self.temp.name) / "peer.sock")
        self.server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.server.bind(path)
        self.server.listen(1)
        self.addCleanup(self.server.close)
        code = '''import socket,sys,time
s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
s.connect(sys.argv[1])
s.sendall(b"ready")
time.sleep(2)
s.close()
'''
        self.client = subprocess.Popen([sys.executable, "-B", "-c", code, path],
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.addCleanup(self.stop_client)
        self.conn, _ = self.server.accept()
        self.addCleanup(self.conn.close)
        self.assertEqual(self.conn.recv(5), b"ready")
        self.pid = self.client.pid
        self.uid = os.geteuid()
        self.gid = os.getegid()
        self.claim = {"schema": "ge04-r2k-v1", "pid": self.pid,
                      "uid": self.uid, "gid": self.gid,
                      "startTimeTicks": mod._proc_generation(self.pid),
                      "bootId": Path("/proc/sys/kernel/random/boot_id").read_text().strip()}

    def stop_client(self):
        if self.client.poll() is None:
            self.client.terminate()
        try:
            self.client.communicate(timeout=3)
        except subprocess.TimeoutExpired:
            self.client.kill()
            self.client.communicate()

    def inspect(self, claim=None, expected_uid=None, forbidden=()):
        # Kernel peer facts are real; the verifier UID is synthetic here.
        # An actual cross-UID privilege boundary remains untested.
        with mock.patch.object(mod.os, "geteuid", return_value=self.uid + 5000):
            return mod.inspect_peer_credentials(
                self.conn, self.claim if claim is None else claim,
                self.uid if expected_uid is None else expected_uid,
                forbidden_uids=forbidden)

    def test_real_kernel_peer_matches_client_not_server(self):
        result = self.inspect()
        self.assertEqual(result["kernelPeer"]["pid"], self.pid)
        self.assertEqual(result["kernelPeer"]["uid"], self.uid)
        self.assertEqual(result["status"], "blocked")
        self.assertTrue(result["peerIdentityConsistent"])  # policy UID synthetic
        self.assertEqual(mod.inspect_peer_credentials(
            self.conn, self.claim, self.uid)["status"], "blocked")
        self.assertFalse(mod.inspect_peer_credentials(
            self.conn, self.claim, self.uid)["peerIdentityConsistent"])

    def test_forged_claimed_pid_rejected(self):
        result = self.inspect(claim={**self.claim, "pid": self.pid + 5})
        self.assertFalse(result["peerIdentityConsistent"])
        self.assertIn("peer claim contradicts kernel SO_PEERCRED", result["reasons"])

    def test_forged_claimed_uid_rejected(self):
        result = self.inspect(claim={**self.claim, "uid": self.uid + 1000},
                              expected_uid=self.uid + 1000)
        self.assertFalse(result["peerIdentityConsistent"])

    def test_generation_mismatch_rejected(self):
        result = self.inspect(claim={**self.claim, "startTimeTicks": "9999999"})
        self.assertIn("peer process generation absent or changed", result["reasons"])

    def test_boot_mismatch_rejected(self):
        result = self.inspect(claim={**self.claim, "bootId": "old-boot"})
        self.assertIn("peer kernel boot generation mismatch", result["reasons"])

    def test_invalid_schema_rejected(self):
        result = self.inspect(claim={**self.claim, "schema": "untrusted"})
        self.assertIn("peer claim version mismatch", result["reasons"])

    def test_forbidden_role_uid_rejected(self):
        result = self.inspect(forbidden=(self.uid,))
        self.assertFalse(result["peerIdentityConsistent"])

    def test_missing_kernel_generation_rejected(self):
        with mock.patch.object(mod.os, "geteuid", return_value=self.uid + 5000):
            result = mod.inspect_peer_credentials(
                self.conn, self.claim, self.uid, generation_reader=lambda _pid: None)
        self.assertFalse(result["peerIdentityConsistent"])

    def test_non_socket_or_wrong_type_rejected(self):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            result = mod.inspect_peer_credentials(s, self.claim, self.uid + 1)
        self.assertEqual(result["status"], "blocked")
        self.assertIsNone(result["kernelPeer"])

    def test_synthetic_distinct_uid_policy_only_consistency(self):
        # Simulates a verifier process with a different UID; *not* a
        # real cross-UID system test or an authorization claim.
        if self.uid == 0:
            self.skipTest("requires a non-root client")
        with mock.patch.object(mod.os, "geteuid", return_value=self.uid + 5000):
            result = self.inspect()
        self.assertTrue(result["peerIdentityConsistent"])
        self.assertEqual(result["status"], "blocked")
        self.assertIn("not privileged issuer authorization", result["reasons"][-1])


if __name__ == "__main__":
    unittest.main()
