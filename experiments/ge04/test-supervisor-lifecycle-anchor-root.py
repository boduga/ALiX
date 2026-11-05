#!/usr/bin/env python3
"""GE-04 separate anchor negative cases (isolated root-only test fixture)."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    'ge04_anchor', Path(__file__).with_name('supervisor-lifecycle-anchor.py'))
anchor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(anchor)


@unittest.skipUnless(os.name == 'posix' and os.geteuid() == 0, 'Linux root CI')
class AnchorTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='ge04-anchor-')
        self.directory = Path(self.temp.name) / 'custody'
        self.directory.mkdir(mode=0o700)
        self.digest = 'a' * 64
        self.chain = 'b' * 64

    def tearDown(self):
        self.temp.cleanup()

    def test_missing_or_mismatched_anchor_denied(self):
        self.assertFalse(anchor.matches(self.directory, self.digest, self.chain))
        anchor.publish(self.directory, self.digest, self.chain)
        self.assertTrue(anchor.matches(self.directory, self.digest, self.chain))
        self.assertFalse(anchor.matches(self.directory, 'c' * 64, self.chain))
        self.assertFalse(anchor.matches(self.directory, self.digest, 'd' * 64))

    def test_create_once(self):
        anchor.publish(self.directory, self.digest, self.chain)
        with self.assertRaises(FileExistsError):
            anchor.publish(self.directory, self.digest, 'c' * 64)

    def test_tamper_malformed_duplicate_fields_and_permissions(self):
        anchor.publish(self.directory, self.digest, self.chain)
        file = self.directory / anchor.NAME
        orig = file.read_bytes()
        file.write_bytes(orig.replace(b'"sequence": 4', b'"sequence": 4, "sequence": 4')
                         .replace(b'"sequence":4', b'"sequence":4,"sequence":4'))
        self.assertFalse(anchor.matches(self.directory, self.digest, self.chain))
        file.write_bytes(orig)
        file.chmod(0o666)
        self.assertFalse(anchor.matches(self.directory, self.digest, self.chain))
        file.chmod(0o600)
        self.assertTrue(anchor.matches(self.directory, self.digest, self.chain))

    def test_symlink_and_untrusted_directory_denied(self):
        anchor.publish(self.directory, self.digest, self.chain)
        record = self.directory / anchor.NAME
        record.unlink()
        record.symlink_to(self.directory / 'missing')
        self.assertFalse(anchor.matches(self.directory, self.digest, self.chain))
        record.unlink()
        self.directory.chmod(0o777)
        self.assertFalse(anchor.matches(self.directory, self.digest, self.chain))


if __name__ == '__main__':
    unittest.main()
