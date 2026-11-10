"""Unprivileged GE-04 prebirth journal crash-window contract tests."""
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

SRC = Path(__file__).resolve().parents[2] / "native/ge04"
sys.path.insert(0, str(SRC))
import prebirth_fixture_journal as journal
from test_ge04_prebirth_issuance_contract import prebirth


@unittest.skipUnless(sys.platform == "linux", "Linux directory fsync only")
class PrebirthJournalTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="ge04-prebirth-journal-")
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "private"
        self.path.mkdir(mode=0o700)
        os.chmod(self.path, 0o700)
        self.fd = os.open(self.path, os.O_RDONLY | os.O_DIRECTORY)
        self.addCleanup(os.close, self.fd)

    def test_exclusive_original_persisted_and_reopen_quarantines(self):
        if os.geteuid() == 0:
            with self.assertRaises(PermissionError):
                journal.publish_fixture_once(self.fd, prebirth(), lambda: True)
            return
        status = journal.publish_fixture_once(self.fd, prebirth(), lambda: True)
        self.assertEqual(status["status"], "UNQUALIFIED_FIXTURE_PREBIRTH_PERSISTED")
        held = journal.inspect_fixture_journal(self.fd)
        self.assertEqual(held["status"], "UNQUALIFIED_QUARANTINE_ON_REOPEN")
        self.assertEqual(held["record"]["nonce"], "b"*64)
        with self.assertRaises(TypeError):
            held["record"]["nonce"] = "a"*64
        with self.assertRaisesRegex(ValueError, "QUARANTINE"):
            journal.publish_fixture_once(self.fd, prebirth(), lambda: True)
        self.assertEqual((self.path / journal.FILENAME).read_bytes(),
                         status["recordBytes"])

    def test_absence_must_be_positively_checked_twice(self):
        if os.geteuid() == 0:
            self.skipTest("Root denied")
        with self.assertRaises(ValueError):
            journal.publish_fixture_once(self.fd, prebirth(), lambda: False)
        self.assertFalse((self.path / journal.FILENAME).exists())
        values = iter((True, False))
        with self.assertRaises(ValueError):
            journal.publish_fixture_once(self.fd, prebirth(),
                                         lambda: next(values))
        self.assertEqual(journal.inspect_fixture_journal(self.fd)["status"],
                         "UNQUALIFIED_QUARANTINE_ON_REOPEN")

    def test_crash_at_every_persistence_boundary_never_retries(self):
        if os.geteuid() == 0:
            self.skipTest("Root denied")
        for marker in ("after-write", "after-file-fsync",
                       "after-directory-fsync"):
            with self.subTest(marker=marker), tempfile.TemporaryDirectory(
                    prefix="ge04-prebirth-fault-") as location:
                root = Path(location) / "private"
                root.mkdir(mode=0o700)
                fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    def fault(point):
                        if point == marker:
                            raise RuntimeError(point)
                    with self.assertRaisesRegex(RuntimeError, marker):
                        journal.publish_fixture_once(fd, prebirth(),
                                                     lambda: True, fault)
                    self.assertTrue((root / journal.FILENAME).exists())
                    self.assertEqual(
                        journal.inspect_fixture_journal(fd)["status"],
                        "UNQUALIFIED_QUARANTINE_ON_REOPEN")
                    with self.assertRaisesRegex(ValueError, "QUARANTINE"):
                        journal.publish_fixture_once(fd, prebirth(), lambda: True)
                finally:
                    os.close(fd)

    def test_user_can_not_replace_existing_intent_or_symlink(self):
        if os.geteuid() == 0:
            self.skipTest("Root denied")
        (self.path / journal.FILENAME).symlink_to("/etc/passwd")
        with self.assertRaises(ValueError):
            journal.publish_fixture_once(self.fd, prebirth(), lambda: True)
        with self.assertRaises(OSError):
            journal.inspect_fixture_journal(self.fd)

    def test_nonprivate_directory_and_root_are_refused(self):
        with mock.patch.object(journal.os, "geteuid", return_value=0):
            with self.assertRaises(PermissionError):
                journal.publish_fixture_once(self.fd, prebirth(), lambda: True)
        os.chmod(self.path, 0o755)
        with self.assertRaises(PermissionError):
            journal.publish_fixture_once(self.fd, prebirth(), lambda: True)

    def test_partial_and_corrupt_journal_stays_unqualified(self):
        if os.geteuid() == 0:
            self.skipTest("Root denied")
        target = self.path / journal.FILENAME
        target.write_bytes(b'{"truncated":true}\n')
        os.chmod(target, 0o600)
        with self.assertRaises(ValueError):
            journal.inspect_fixture_journal(self.fd)
        with self.assertRaises(ValueError):
            journal.publish_fixture_once(self.fd, prebirth(), lambda: True)

    def test_replacement_with_identical_bytes_after_fsync_refuses(self):
        if os.geteuid() == 0:
            self.skipTest("Root denied")
        def substitute(stage):
            if stage == "after-file-fsync":
                target = self.path / journal.FILENAME
                raw = target.read_bytes()
                target.unlink()
                target.write_bytes(raw)
                os.chmod(target, 0o600)
        with self.assertRaises(ValueError):
            journal.publish_fixture_once(self.fd, prebirth(), lambda: True,
                                         substitute)
        with self.assertRaises(ValueError):
            journal.publish_fixture_once(self.fd, prebirth(), lambda: True)

    def test_last_absence_probe_removing_record_refuses(self):
        if os.geteuid() == 0:
            self.skipTest("Root denied")
        calls = [0]
        def probe():
            calls[0] += 1
            if calls[0] == 2:
                (self.path / journal.FILENAME).unlink()
            return True
        with self.assertRaises((ValueError, FileNotFoundError)):
            journal.publish_fixture_once(self.fd, prebirth(), probe)
        self.assertEqual(calls[0], 2)

    def test_noncanonical_and_missing_fields_never_write(self):
        if os.geteuid() == 0:
            self.skipTest("Root denied")
        with self.assertRaises(ValueError):
            journal.publish_fixture_once(
                self.fd, {**prebirth(), "nonce": "bad"}, lambda: True)
        self.assertFalse((self.path / journal.FILENAME).exists())
