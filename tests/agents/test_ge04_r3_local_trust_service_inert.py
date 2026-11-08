"""Linux local AF_UNIX peer-credential fixture tests; no TPM calls."""
from __future__ import annotations

import array
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import unittest

p = Path(__file__).resolve().parents[2] / "scripts/ge04-r3-local-trust-service-inert.py"
spec = importlib.util.spec_from_file_location("ge04_r3_inert_trust_test", p)
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)


def request(**changes):
    msg = {"schema": "ge04-r3-tpm3-inert-v1", "operation": "status.read",
           "requestId": "req-00000000000001", "nonce": "a" * 64}
    msg.update(changes)
    return json.dumps(msg, separators=(",", ":")).encode("ascii")


@unittest.skipUnless(sys.platform == "linux", "Linux Unix peer credentials")
class LocalTrustTransportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="alix-tpm3-")
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "trust.sock"
        self.fixture = service.InertLocalTrustService(
            self.path, expected_client_uid=os.getuid())
        self.fixture.start()
        self.addCleanup(self.fixture.close)

    def exchange(self, payload=None, *, descriptors=()):
        results = []
        def serve():
            results.append(self.fixture.serve_once())
        worker = threading.Thread(target=serve, daemon=True)
        worker.start()
        with socket.socket(socket.AF_UNIX, socket.SOCK_SEQPACKET) as client:
            client.settimeout(2)
            client.connect(str(self.path))
            if descriptors:
                client.sendmsg([payload or request()],
                               [(socket.SOL_SOCKET, socket.SCM_RIGHTS,
                                 array.array("i", descriptors))])
            else:
                client.sendall(request() if payload is None else payload)
            reply = client.recv(512)
        worker.join(3)
        self.assertFalse(worker.is_alive(), "fixture listener stalled")
        self.assertEqual(reply, service.DENIED)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["status"], "blocked")
        self.assertTrue(results[0]["securityHoldActive"])
        self.assertFalse(results[0]["authorizationGranted"])
        return results[0]

    def test_matching_kernel_identity_only_diagnostic(self):
        result = self.exchange()
        self.assertTrue(result["peerConsistent"])
        self.assertTrue(result["requestConsistent"])
        self.assertFalse(result["authorizationGranted"])

    def test_replay_in_process_denied(self):
        self.assertTrue(self.exchange()["requestConsistent"])
        response = self.exchange()
        self.assertTrue(response["replay"])
        self.assertFalse(response["requestConsistent"])

    def test_restart_forgets_ephemeral_nonces_but_never_authorizes(self):
        self.assertTrue(self.exchange()["requestConsistent"])
        self.fixture.close()
        self.fixture = service.InertLocalTrustService(
            self.path, expected_client_uid=os.getuid())
        self.fixture.start()
        self.addCleanup(self.fixture.close)
        again = self.exchange()
        self.assertTrue(again["requestConsistent"])
        self.assertFalse(again["authorizationGranted"])

    def test_invalid_schema_and_mutation_rejected(self):
        for payload in (
            request(schema="ge04-r3-admin"),
            request(operation="checkpoint.commit"),
            request(operation="tpm.nvextend"),
            request(operation="worker.execute"),
            request(operation="worker.recover"),
            request(nonce="z"*64),
            request(requestId=""),
            b"{",
            b"{}",
            b'{"schema":"ge04-r3-tpm3-inert-v1","schema":"duplicate"}',
            b"x"*4097,
        ):
            with self.subTest(payload=payload[:80]):
                response = self.exchange(payload)
                self.assertFalse(response["requestConsistent"])

    def test_wrong_uid_denied_from_kernel_not_claim(self):
        self.fixture.expected_client_uid = os.getuid()+12345
        response = self.exchange()
        self.assertFalse(response["peerConsistent"])
        self.assertFalse(response["requestConsistent"])

    def test_fd_delegation_rejected_and_no_response_authorization(self):
        with open("/dev/null", "rb") as f:
            response = self.exchange(descriptors=(f.fileno(),))
        self.assertFalse(response["requestConsistent"])

    def test_socket_directory_and_existing_path_protected(self):
        second = service.InertLocalTrustService(self.path,
                                                 expected_client_uid=os.getuid())
        with self.assertRaises(service.TrustServiceError):
            second.start()
        self.assertTrue(self.path.exists())
        self.fixture.close()
        self.path.symlink_to("/dev/null")
        with self.assertRaises(service.TrustServiceError):
            second.start()
        self.assertTrue(self.path.is_symlink())

    def test_wrong_parent_permissions_denied(self):
        self.fixture.close()
        os.chmod(self.tmp.name, 0o777)
        with self.assertRaises(service.TrustServiceError):
            self.fixture.start()

    def test_close_does_not_remove_replaced_socket(self):
        original = self.path
        other = Path(self.tmp.name) / "other.sock"
        original.rename(other)
        original.write_text("replacement")
        self.fixture.close()
        self.assertTrue(original.exists())

    def test_executable_entrypoint_refuses_start(self):
        result = subprocess.run([sys.executable, str(p)], capture_output=True,
                                text=True, timeout=4)
        self.assertEqual(result.returncode, 78)
        self.assertIn("SECURITY HOLD", result.stderr)


if __name__ == "__main__":
    unittest.main()
