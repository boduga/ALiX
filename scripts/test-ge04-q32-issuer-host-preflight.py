#!/usr/bin/env python3
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

PATH = Path(__file__).with_name('ge04-q32-issuer-host-preflight.py')
spec = importlib.util.spec_from_file_location('q32_host', PATH)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class Tests(unittest.TestCase):
    def test_missing_users_warns(self):
        r = mod.inspect(dict.fromkeys(('issuer', 'supervisor', 'coordinator', 'attacker'), 'nonexistent_alix_q32_user'), {})
        self.assertIn('issuer:missing_identity', r['warnings'])
        self.assertFalse(r['qualified_independent_issuance'])

    def test_relative_path_warns(self):
        r = mod.inspect({}, {'test': 'relative'})
        self.assertIn('test:nonabsolute_path', r['warnings'])

    def test_symlink_warns(self):
        with tempfile.TemporaryDirectory() as tmp:
            link = Path(tmp) / 'link'
            link.symlink_to('/tmp')
            r = mod.inspect({}, {'test': str(link)})
            self.assertIn('test:symlink_component', r['warnings'])

    def test_entrypoint_hold(self):
        p = subprocess.run([sys.executable, '-B', str(PATH), '--issuer', 'missing', '--supervisor', 'missing',
                            '--coordinator', 'missing', '--attacker', 'missing'], capture_output=True, text=True)
        self.assertEqual(p.returncode, 78)
        self.assertEqual(json.loads(p.stdout)['disposition'], 'HOLD')

if __name__ == '__main__':
    unittest.main()
