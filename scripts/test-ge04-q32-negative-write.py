#!/usr/bin/env python3
"""CI-safe fail-closed tests; privileged host evidence remains pending."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('ge04-q32-negative-write.py')


class NegativeWriteTests(unittest.TestCase):
    def invoke(self, *args):
        return subprocess.run([sys.executable, '-B', str(SCRIPT), *args],
                              capture_output=True, text=True, timeout=5)

    def test_default_holds(self):
        r = self.invoke()
        self.assertEqual(r.returncode, 78)
        self.assertEqual(json.loads(r.stdout)['disposition'], 'HOLD')

    def test_no_implicit_root(self):
        r = self.invoke('--isolated-test', '--supervisor', 'missing',
                        '--coordinator', 'missing', '--attacker', 'missing',
                        '--group', 'missing')
        self.assertEqual(r.returncode, 78)

    def test_worker_requires_directory(self):
        self.assertEqual(self.invoke('--worker').returncode, 78)

    def test_worker_refuses_nonfixture_path(self):
        with tempfile.TemporaryDirectory() as d:
            r = self.invoke('--worker', '--directory', d)
            self.assertEqual(r.returncode, 78)
            self.assertEqual(json.loads(r.stdout)['disposition'], 'HOLD')


if __name__ == '__main__':
    unittest.main()
