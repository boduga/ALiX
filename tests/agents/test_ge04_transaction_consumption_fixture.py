"""GE-04 unprivileged durable-consumption fixture; NOT production fencing."""
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

SRC = Path(__file__).resolve().parents[2] / "native/ge04"
sys.path.insert(0, str(SRC))
from prebirth_fixture_journal import publish_fixture_once
from test_ge04_cross_source_birth_reconciliation import packet
import transaction_consumption_fixture as fixture


@unittest.skipUnless(sys.platform == "linux", "Linux fsync fixture")
class ConsumptionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="ge04-consumption-")
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "original"
        self.path.mkdir(mode=0o700)
        os.chmod(self.path, 0o700)
        self.fd = os.open(self.path, os.O_DIRECTORY | os.O_RDONLY)
        self.addCleanup(os.close, self.fd)
        if os.geteuid() != 0:
            publish_fixture_once(self.fd, packet()["prebirth"], lambda: True)

    def test_once_success_still_unqualified_and_reopen_quarantines(self):
        if os.geteuid() == 0:
            self.skipTest("Root denied")
        result = fixture.consume_packet_once(self.fd, packet())
        self.assertEqual(result["status"], "UNQUALIFIED_JOURNALED_PACKET_CORRELATION")
        self.assertEqual(result["diagnostic"]["status"],
                         "UNQUALIFIED_CROSS_SOURCE_BIRTH_CORRELATION")
        self.assertEqual(fixture.inspect_consumption_after_restart(self.fd)["status"],
                         "UNQUALIFIED_QUARANTINE_ON_RESTART")
        with self.assertRaises(FileExistsError):
            fixture.consume_packet_once(self.fd, packet())
        with self.assertRaises(TypeError):
            result["status"] = "AUTHORIZED"

    def test_fault_injections_preserve_single_use(self):
        if os.geteuid() == 0:
            self.skipTest("Root denied")
        for marker in ("after-write", "after-file-fsync",
                       "after-directory-fsync", "after-reconciliation"):
            with self.subTest(marker=marker), tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / "private"
                path.mkdir(mode=0o700)
                fd = os.open(path, os.O_DIRECTORY | os.O_RDONLY)
                try:
                    publish_fixture_once(fd, packet()["prebirth"], lambda: True)
                    def fault(stage):
                        if stage == marker:
                            raise RuntimeError(stage)
                    with self.assertRaisesRegex(RuntimeError, marker):
                        fixture.consume_packet_once(fd, packet(), fault=fault)
                    with self.assertRaises(FileExistsError):
                        fixture.consume_packet_once(fd, packet())
                finally:
                    os.close(fd)

    def test_failed_reconciliation_consumes_attempt(self):
        if os.geteuid() == 0:
            self.skipTest("Root denied")
        value = packet()
        value["job_event"]["result"] = "failed"
        with self.assertRaises(ValueError):
            fixture.consume_packet_once(self.fd, value)
        with self.assertRaises(FileExistsError):
            fixture.consume_packet_once(self.fd, packet())
        self.assertEqual(fixture.inspect_consumption_after_restart(self.fd)["status"],
                         "UNQUALIFIED_QUARANTINE_ON_RESTART")

    def test_packet_mutated_to_different_consistent_attempt_is_refused(self):
        if os.geteuid() == 0:
            self.skipTest("Root denied")
        import hashlib
        from prebirth_issuance_contract import canonical_prebirth
        value = packet()
        def change_packet(stage):
            if stage == "after-directory-fsync":
                other = {**value["prebirth"], "nonce": "a" * 64}
                raw = canonical_prebirth(other)
                digest = hashlib.sha256(raw).hexdigest()
                value["prebirth"] = other
                value["journal"] = {
                    "status": "UNQUALIFIED_FIXTURE_PREBIRTH_PERSISTED",
                    "recordBytes": raw,
                }
                value["creation"] = {**value["creation"],
                                      "nonce": other["nonce"],
                                      "prebirthSha256": digest}
                value["completion"] = {**value["completion"],
                                        "prebirthSha256": digest}
                value["original"] = {**value["original"],
                                     "nonce": other["nonce"]}
                value["birth_claim"] = {**value["birth_claim"],
                                        "nonce": other["nonce"]}
        with self.assertRaisesRegex(ValueError, "consumed attempt"):
            fixture.consume_packet_once(self.fd, value, fault=change_packet)
        with self.assertRaises(FileExistsError):
            fixture.consume_packet_once(self.fd, packet())
        self.assertEqual(fixture.inspect_consumption_after_restart(self.fd)["status"],
                         "UNQUALIFIED_QUARANTINE_ON_RESTART")

    def test_wrong_original_never_creates_marker(self):
        if os.geteuid() == 0:
            self.skipTest("Root denied")
        value = packet()
        value["prebirth"]["nonce"] = "f"*64
        with self.assertRaises(ValueError):
            fixture.consume_packet_once(self.fd, value)
        self.assertFalse((self.path / fixture.NAME).exists())

    def test_marker_tamper_and_symlink_cannot_be_adopted(self):
        if os.geteuid() == 0:
            self.skipTest("Root denied")
        target = self.path / fixture.NAME
        target.symlink_to("/etc/passwd")
        with self.assertRaises(FileExistsError):
            fixture.consume_packet_once(self.fd, packet())
        with self.assertRaises(OSError):
            fixture.inspect_consumption_after_restart(self.fd)

    def test_replacement_after_fsync_refused(self):
        if os.geteuid() == 0:
            self.skipTest("Root denied")
        def fault(marker):
            if marker == "after-directory-fsync":
                target = self.path / fixture.NAME
                raw = target.read_bytes()
                target.unlink()
                target.write_bytes(raw)
                target.chmod(0o600)
        with self.assertRaises(ValueError):
            fixture.consume_packet_once(self.fd, packet(), fault=fault)

    def test_user_owned_source_is_not_root_authority(self):
        with mock.patch.object(fixture.os, "geteuid", return_value=0):
            with self.assertRaises(PermissionError):
                fixture.consume_packet_once(self.fd, packet())
        with mock.patch.object(fixture.os, "geteuid", return_value=0):
            with self.assertRaises(PermissionError):
                fixture.inspect_consumption_after_restart(self.fd)

    def test_nonprivate_directory_denied(self):
        if os.geteuid() == 0:
            self.skipTest("Root denied")
        os.chmod(self.path, 0o755)
        with self.assertRaises(PermissionError):
            fixture.consume_packet_once(self.fd, packet())
