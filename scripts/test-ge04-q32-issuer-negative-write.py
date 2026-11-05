#!/usr/bin/env python3
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest

PATH = Path(__file__).with_name('ge04-q32-issuer-negative-write.py')
spec = importlib.util.spec_from_file_location('issuer_negative', PATH)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class Tests(unittest.TestCase):
    def test_default_hold(self):
        p = subprocess.run([sys.executable, '-B', str(PATH)], capture_output=True, text=True)
        self.assertEqual(p.returncode, 78)
        self.assertFalse(json.loads(p.stdout)['qualified_independent_issuance'])

    def test_missing_users_hold(self):
        p = subprocess.run([sys.executable, '-B', str(PATH), '--isolated-test'], capture_output=True, text=True)
        self.assertEqual(p.returncode, 78)

    def test_worker_rejects_missing_directory(self):
        self.assertEqual(mod.main.__name__, 'main')
        p = subprocess.run([sys.executable, '-B', str(PATH), '--worker'], capture_output=True, text=True)
        self.assertEqual(p.returncode, 78)

    def test_worker_rejects_outside_fixture(self):
        p = subprocess.run([sys.executable, '-B', str(PATH), '--worker', '--directory', '/etc'], capture_output=True, text=True)
        self.assertEqual(p.returncode, 78)

if __name__ == '__main__':
    unittest.main()
