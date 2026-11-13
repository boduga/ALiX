"""GE-04 existing approval custody diagnostics. No privileged filesystem writes."""
import os
from pathlib import Path
import stat
import sys
import tempfile
import types
import unittest
from unittest import mock

SRC = Path(__file__).resolve().parents[2] / "native/ge04"
sys.path.insert(0, str(SRC))
import protected_approval_observer as approval
from test_ge04_phase_controller import original


def _root_stat(info):
    # Explicit synthetic metadata only. Never constitutes actual root custody.
    return types.SimpleNamespace(
        st_mode=info.st_mode, st_uid=0, st_gid=0,
        st_dev=info.st_dev, st_ino=info.st_ino, st_nlink=info.st_nlink,
        st_size=info.st_size, st_mtime_ns=info.st_mtime_ns,
        st_ctime_ns=info.st_ctime_ns,
    )


class ExistingApprovalTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="ge04-approval-read-")
        self.addCleanup(self.tmp.cleanup)
        self.work = Path(self.tmp.name) / "work"
        self.parent = Path(self.tmp.name) / "parent"
        self.work.mkdir(mode=0o700)
        self.parent.mkdir(mode=0o700)
        (self.work / ".lock").write_bytes(b"")
        (self.work / "approval.v1").write_bytes(
            ("GE04VA1 " + "a" * 32 + f" {self.parent.stat().st_dev} "
             + f"{self.parent.stat().st_ino}\n").encode())
        os.chmod(self.work / ".lock", 0o600)
        os.chmod(self.work / "approval.v1", 0o600)

    def synthetic_observation(self, expected):
        real_fstat = os.fstat
        def opened(parts, exact_last=False):
            path = self.work if parts == approval.WORK_COMPONENTS else self.parent
            return os.open(path, os.O_RDONLY | os.O_DIRECTORY)
        with (mock.patch.object(approval, "_directory_chain", side_effect=opened),
              mock.patch.object(approval.os, "fstat",
                                side_effect=lambda fd: _root_stat(real_fstat(fd)))):
            return approval.corroborate_existing_approval(expected)

    def test_matching_synthetic_approval_only_unqualified(self):
        expected = original()
        chain = list(expected["ancestry"])
        chain[-1] = (self.parent.stat().st_dev, self.parent.stat().st_ino)
        expected["ancestry"] = tuple(chain)
        result = self.synthetic_observation(expected)
        self.assertEqual(result["status"],
                         "UNQUALIFIED_ORIGINAL_APPROVAL_CORRELATION")
        self.assertEqual(result["invocation"], "a" * 32)
        with self.assertRaises(TypeError):
            result["invocation"] = "b" * 32

    def test_wrong_invocation_or_inode_refuses(self):
        expected = original()
        ancestry = list(expected["ancestry"])
        ancestry[-1] = (self.parent.stat().st_dev, self.parent.stat().st_ino)
        expected["ancestry"] = tuple(ancestry)
        for bad in ({**expected, "invocation": "b" * 32},
                    {**expected, "ancestry": ((1, 2), (1, 3), (1, 4))}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                self.synthetic_observation(bad)

    def test_malformed_approval_and_lock_must_refuse(self):
        expected = original()
        ancestry = list(expected["ancestry"])
        ancestry[-1] = (self.parent.stat().st_dev, self.parent.stat().st_ino)
        expected["ancestry"] = tuple(ancestry)
        for raw in (b"GE04VA1 junk 1 2\n", b"GE04VA1 " + b"a"*32 +
                    b" 0001 2\n", b"GE04VA1 " + b"a"*32 + b" 1 2"):
            (self.work / "approval.v1").write_bytes(raw)
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                self.synthetic_observation(expected)
        (self.work / ".lock").write_bytes(b"unexpected")
        with self.assertRaises(ValueError):
            self.synthetic_observation(expected)

    def test_user_owned_file_refused_even_with_matching_bytes(self):
        file_path = self.work / "approval.v1"
        directory = os.open(self.work, os.O_RDONLY | os.O_DIRECTORY)
        try:
            with self.assertRaises(ValueError):
                approval._protected_file(directory, "approval.v1", 0o600, 256)
        finally:
            os.close(directory)

    def test_directory_symlinks_never_followed(self):
        base = Path(self.tmp.name) / "a"
        base.mkdir(mode=0o700)
        (base / "link").symlink_to(self.work, target_is_directory=True)
        rootfd = os.open(base, os.O_RDONLY | os.O_DIRECTORY)
        try:
            with mock.patch.object(approval, "_safe_dir",
                                   side_effect=lambda fd, exact=False: os.fstat(fd)):
                with self.assertRaises(OSError):
                    approval._directory_chain(("link",), root_fd=rootfd)
        finally:
            os.close(rootfd)

    def test_live_fixed_approval_never_minted(self):
        try:
            observed = approval.corroborate_existing_approval(original())
        except (OSError, ValueError):
            return
        self.assertEqual(observed["status"],
                         "UNQUALIFIED_ORIGINAL_APPROVAL_CORRELATION")
