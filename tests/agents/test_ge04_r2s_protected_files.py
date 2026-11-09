"""R2S pinned trust-file hostile path/permission tests; no host changes."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

SOURCE = Path(__file__).resolve().parents[2] / "scripts/ge04-r2s-protected-files.py"
spec = importlib.util.spec_from_file_location("ge04_protected", SOURCE)
protected = importlib.util.module_from_spec(spec)
spec.loader.exec_module(protected)


class ProtectedFilesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="ge04-protected-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.file = self.root / "trust.json"
        self.file.write_bytes(b'{"version":1}')
        self.file.chmod(0o600)
        # Test fixtures are user-owned and placed under shared /tmp.
        # Only bypass ancestor ownership policy, retain real O_NOFOLLOW and
        # descriptor fstat leaf checks. Production callers pass owner_uid=0.
        self.real_directory_guard = protected._require_directory
        parent = mock.patch.object(protected, "_require_directory", lambda fd, owner: None)
        parent.start()
        self.addCleanup(parent.stop)

    def read(self, path=None, **opts):
        return protected.read_protected(
            str(path or self.file), maximum=512, owner_uid=os.geteuid(), **opts)

    def test_reads_descriptor_pinned_regular_file(self):
        self.assertEqual(self.read(), b'{"version":1}')

    def test_symlink_leaf_denied_even_with_matching_target(self):
        alias = self.root / "alias"
        alias.symlink_to(self.file)
        with self.assertRaises(OSError):
            self.read(alias)

    def test_symlink_parent_denied(self):
        alias = self.root / "alias-dir"
        alias.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(OSError):
            self.read(alias / "trust.json")

    def test_world_writable_leaf_denied(self):
        self.file.chmod(0o666)
        with self.assertRaises(PermissionError):
            self.read()

    def test_publicly_readable_private_key_denied(self):
        self.file.chmod(0o644)
        with self.assertRaises(PermissionError):
            protected.read_protected(str(self.file), maximum=512,
                                     owner_uid=os.geteuid(), private=True)

    def test_group_writable_leaf_denied(self):
        self.file.chmod(0o620)
        with self.assertRaises(PermissionError):
            self.read()

    def test_hardlink_leaf_denied(self):
        os.link(self.file, self.root / "copy")
        with self.assertRaises(PermissionError):
            self.read()

    def test_oversized_leaf_denied(self):
        self.file.write_bytes(b"x" * 513)
        with self.assertRaises(PermissionError):
            self.read()

    def test_noncanonical_paths_denied(self):
        for suffix in ("../trust.json", "./trust.json", "a//trust.json"):
            with self.subTest(suffix=suffix), self.assertRaises(ValueError):
                self.read(str(self.root) + "/" + suffix)

    def test_unsafe_parent_rejected_by_real_policy(self):
        # Fixture under a world-writable shared temp directory is not a
        # provisioned root-owned trust tree. Test direct policy on an opened fd.
        directory = os.open(str(self.root), os.O_RDONLY | os.O_DIRECTORY)
        try:
            with self.assertRaises(PermissionError):
                self.real_directory_guard(directory, owner_uid=0)
        finally:
            os.close(directory)

    def test_fd_survives_leaf_replacement_without_following_new_path(self):
        descriptor = protected.open_protected_fd(
            str(self.file), maximum=512, owner_uid=os.geteuid())
        try:
            replacement = self.root / "replacement"
            replacement.write_bytes(b'{"version":2}')
            os.replace(replacement, self.file)
            os.lseek(descriptor, 0, os.SEEK_SET)
            self.assertEqual(os.read(descriptor, 512), b'{"version":1}')
        finally:
            os.close(descriptor)

    def test_signer_rejects_invalid_length(self):
        self.file.write_bytes(b"k" * 33)
        with self.assertRaises(PermissionError):
            protected.open_protected_fd(str(self.file), maximum=32, owner_uid=os.geteuid())

if __name__ == "__main__":
    unittest.main()
