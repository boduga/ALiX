#!/usr/bin/env python3
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest
P = Path(__file__).with_name('ge04-q32-issuer-cross-uid.py')
spec = importlib.util.spec_from_file_location('cross_uid', P)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
class Tests(unittest.TestCase):
    def test_roles(self):
        self.assertEqual(len(m.ROLES), 4)
    def test_missing_identity_fails(self):
        with self.assertRaises(KeyError):
            m.accounts({})
    def test_duplicate_uid_fails(self):
        import pwd
        user = pwd.getpwuid(0)
        with self.assertRaises(ValueError):
            m.accounts(dict.fromkeys(m.ROLES, user.pw_name))
    def test_no_opt_in_hold(self):
        p = subprocess.run([sys.executable, '-B', str(P), *sum((['--'+r, 'root'] for r in m.ROLES), [])], capture_output=True, text=True)
        self.assertEqual(p.returncode, 78)
        self.assertEqual(json.loads(p.stdout)['disposition'], 'HOLD')
if __name__ == '__main__':
    unittest.main()
