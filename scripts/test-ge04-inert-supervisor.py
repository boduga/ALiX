#!/usr/bin/env python3
"""Nonprivileged, disposable negative tests for the GE-04 inert IPC harness."""
import importlib.util
import os
from pathlib import Path
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import unittest

SCRIPT = Path(__file__).with_name("ge04-inert-supervisor.py")
spec = importlib.util.spec_from_file_location("ge04_inert", SCRIPT)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


@unittest.skipUnless(sys.platform == "linux", "Linux kernel peer credential contract")
class InertSupervisorTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="alix-ge04-inert-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        os.chmod(self.root, 0o700)
        self.path = self.root / "socket"

    def exchange(self, expected_uid, *, data=b'{"operation":"create","uid":0}',
                 ancillary=None):
        # UID mismatch changes the peer verdict, but NEVER the response.
        server = module.InertSupervisor(
            self.path, expected_uid=expected_uid, supervisor_uid=os.getuid() + 1
        )
        server.start()
        outcome = []
        error = []
        def listen():
            try:
                outcome.append(server.serve_once())
            except BaseException as exc:
                error.append(exc)
        thread = threading.Thread(target=listen)
        thread.start()
        with socket.socket(socket.AF_UNIX, socket.SOCK_SEQPACKET) as client:
            client.connect(str(self.path))
            if ancillary:
                client.sendmsg([data], ancillary)
            else:
                client.send(data)
            response = client.recv(128)
        thread.join(timeout=4)
        server.close()
        self.assertFalse(thread.is_alive(), "supervisor must complete bounded request")
        self.assertFalse(error, str(error))
        self.assertEqual(response, module.DENIED)
        self.assertFalse(self.path.exists(), "listener cleans only its own socket")
        return outcome[0]

    def test_authenticated_looking_request_is_always_denied(self):
        self.assertTrue(self.exchange(os.getuid()))

    def test_wrong_kernel_uid_cannot_impersonate_coordinator_in_json(self):
        self.assertFalse(self.exchange(os.getuid() + 123))

    def test_ancillary_file_descriptor_is_rejected_and_closed(self):
        read_fd, write_fd = os.pipe()
        try:
            self.assertFalse(self.exchange(
                os.getuid(),
                ancillary=[(socket.SOL_SOCKET, socket.SCM_RIGHTS,
                            struct.pack("i", read_fd))],
            ))
        finally:
            os.close(read_fd)
            os.close(write_fd)

    def test_oversized_frame_is_denied(self):
        self.assertFalse(self.exchange(os.getuid(), data=b"A" * 5000))

    def test_private_parent_and_existing_socket_path_are_required(self):
        os.chmod(self.root, 0o755)
        server = module.InertSupervisor(
            self.path, os.getuid(), os.getuid() + 1
        )
        with self.assertRaises(module.TrustError):
            server.start()
        os.chmod(self.root, 0o700)
        self.path.write_text("must remain unchanged", encoding="utf8")
        with self.assertRaises(module.TrustError):
            server.start()
        self.assertEqual(self.path.read_text(encoding="utf8"), "must remain unchanged")

    def test_identity_requires_distinct_uids(self):
        peer = (os.getpid(), os.getuid(), os.getgid())
        self.assertFalse(module.pinned_peer_matches(peer, os.getuid(), os.getuid()))
        self.assertTrue(module.pinned_peer_matches(peer, os.getuid(), os.getuid() + 1))
        self.assertFalse(module.pinned_peer_matches(peer, os.getuid() + 1, os.getuid()))

    def test_user_owned_trust_config_is_not_accepted_as_root_anchor(self):
        trust = self.root / "config"
        trust.write_text("test", encoding="utf8")
        with self.assertRaises(module.TrustError):
            module.trusted_install_preflight(trust)


class EntrypointTests(unittest.TestCase):
    def test_direct_execution_stays_disabled(self):
        process = subprocess.run(
            [sys.executable, str(SCRIPT)], capture_output=True, text=True, timeout=5
        )
        self.assertEqual(process.returncode, 78)
        self.assertIn("SECURITY HOLD", process.stderr)


if __name__ == "__main__":
    unittest.main()
