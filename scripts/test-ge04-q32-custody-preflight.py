#!/usr/bin/env python3
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

PATH = Path(__file__).with_name('ge04-q32-custody-preflight.py')
spec = importlib.util.spec_from_file_location('ge04_q32_custody', PATH)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class CustodyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='alix-q32-custody-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        os.chmod(self.root, 0o700)
        for name in ('policy.json', 'claims.sqlite', 'issuer.pub'):
            p = self.root / name
            p.write_bytes(b'fixture only')
            p.chmod(0o600)

    def check(self, uid=None, coordinator=None):
        return mod.inspect_custody(self.root, os.getuid() if uid is None else uid,
                                   os.getuid() + 1 if coordinator is None else coordinator)

    def test_clean_snapshot_still_holds(self):
        result = self.check()
        self.assertTrue(result['snapshot_checks_passed'])
        self.assertFalse(result['qualified_independent_custody'])
        self.assertEqual(result['response'], mod.DENIED)

    def test_wrong_owner_expectation(self):
        self.assertIn('root_owner', self.check(uid=os.getuid() + 10)['failures'])

    def test_same_uid_rejected(self):
        self.assertIn('invalid_identity_or_path', self.check(coordinator=os.getuid())['failures'])

    def test_group_writable_root_rejected(self):
        self.root.chmod(0o770)
        self.assertIn('root_type_or_mode', self.check()['failures'])

    def test_symlink_rejected(self):
        p = self.root / 'issuer.pub'
        p.unlink()
        p.symlink_to(self.root / 'policy.json')
        self.assertIn('issuer.pub_type_or_mode', self.check()['failures'])

    def test_missing_and_world_readable_rejected(self):
        (self.root / 'claims.sqlite').unlink()
        (self.root / 'policy.json').chmod(0o644)
        failures = self.check()['failures']
        self.assertIn('claims.sqlite_unavailable', failures)
        self.assertIn('policy.json_type_or_mode', failures)

    def test_hardlink_rejected(self):
        os.link(self.root / 'policy.json', self.root / 'duplicate')
        self.assertIn('policy.json_link_count', self.check()['failures'])

    def test_entrypoint_always_holds(self):
        r = subprocess.run([sys.executable, '-B', str(PATH), '--root', str(self.root),
                            '--supervisor-uid', str(os.getuid()),
                            '--coordinator-uid', str(os.getuid()+1)],
                           capture_output=True, text=True, timeout=5)
        self.assertEqual(r.returncode, 78)
        self.assertIn('"disposition": "HOLD"', r.stdout)


if __name__ == '__main__':
    unittest.main()
