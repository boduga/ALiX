"""R2G descriptor-relative qualification-only negative tests."""
import importlib.util
import os
import pathlib
import tempfile
import unittest
from unittest import mock

SOURCE = pathlib.Path(__file__).resolve().parents[2] / "scripts/ge04-r2g-fd-recovery-probe.py"
spec = importlib.util.spec_from_file_location("ge04_r2g", SOURCE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class PinnedRecoveryProbeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="ge04-r2g-")
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.leaf = self.root / "leaf"
        self.leaf.mkdir()
        (self.leaf / "cgroup.events").write_text("populated 0\n")
        st = self.leaf.stat()
        self.expected = (st.st_dev, st.st_ino)
        raw = pathlib.Path("/proc/self/stat").read_text()
        self.ticks = mod._start_ticks(raw)

    def check(self, **kwargs):
        return mod.probe("leaf", os.getpid(), self.ticks,
                         self.expected, root=str(self.root), **kwargs)

    def test_matching_generation_empty_leaf_stays_blocked(self):
        observed = self.check()
        self.assertEqual(observed["process"], "matching")
        self.assertEqual(observed["populated"], "no")
        self.assertTrue(observed["leaf_identity_stable"])
        self.assertTrue(observed["matches_expected_leaf"])
        self.assertEqual(observed["status"], "blocked")

    def test_wrong_generation_stays_blocked(self):
        result = mod.probe("leaf", os.getpid(), "999999999999",
                           self.expected, root=str(self.root))
        self.assertEqual(result["process"], "different")
        self.assertEqual(result["status"], "blocked")

    def test_expected_inode_mismatch_stays_blocked(self):
        result = mod.probe("leaf", os.getpid(), self.ticks,
                           (self.expected[0], self.expected[1] + 1),
                           root=str(self.root))
        self.assertFalse(result["matches_expected_leaf"])
        self.assertEqual(result["status"], "blocked")

    def test_symlink_leaf_rejected(self):
        (self.root / "alias").symlink_to(self.leaf)
        result = mod.probe("alias", os.getpid(), self.ticks,
                           self.expected, root=str(self.root))
        self.assertFalse(result["leaf_identity_stable"])
        self.assertEqual(result["status"], "blocked")

    def test_path_replacement_detected_after_open(self):
        original = mod._read_relative
        replaced = False

        def switch(fd, name):
            nonlocal replaced
            if name == "cgroup.events" and not replaced:
                replaced = True
                self.leaf.rename(self.root / "old")
                self.leaf.mkdir()
                (self.leaf / "cgroup.events").write_text("populated 0\n")
            return original(fd, name)

        with mock.patch.object(mod, "_read_relative", side_effect=switch):
            result = self.check()
        self.assertEqual(result["populated"], "no")
        self.assertFalse(result["leaf_identity_stable"])
        self.assertEqual(result["status"], "blocked")

    def test_malformed_events_are_unknown(self):
        (self.leaf / "cgroup.events").write_text("populated 0\npopulated 1\n")
        result = self.check()
        self.assertEqual(result["populated"], "unknown")
        self.assertEqual(result["status"], "blocked")

    def test_invalid_relative_paths_rejected(self):
        for leaf in ("../escape", "/absolute", "leaf/..", "leaf//file", ""):
            with self.subTest(leaf=leaf), self.assertRaises(ValueError):
                mod.probe(leaf, os.getpid(), self.ticks,
                          self.expected, root=str(self.root))

    def test_missing_pid_is_not_proof_of_recovery(self):
        result = mod.probe("leaf", 99999999, self.ticks,
                           self.expected, root=str(self.root))
        self.assertEqual(result["process"], "absent")
        self.assertEqual(result["status"], "blocked")


if __name__ == "__main__":
    unittest.main()
