#!/usr/bin/env python3
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest

PATH = Path(__file__).with_name('ge04-q32-host-privilege-snapshot.py')
spec = importlib.util.spec_from_file_location('q32_priv', PATH)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class Tests(unittest.TestCase):
    def test_hold(self):
        r = mod.inspect([])
        self.assertEqual(r['disposition'], 'HOLD')
        self.assertFalse(r['qualified_independent_issuance'])
    def test_relative_path(self):
        self.assertIn('path_0:not_absolute', mod.inspect(['relative'])['warnings'])
    def test_proc_fields(self):
        r = mod.inspect([])
        if Path('/proc/self/status').exists():
            self.assertIn('Uid', r['observations']['self_process'])
    def test_cli_exit(self):
        p = subprocess.run([sys.executable, '-B', str(PATH)], capture_output=True, text=True)
        self.assertEqual(p.returncode, 78)
        self.assertEqual(json.loads(p.stdout)['gate'], mod.GATE)

if __name__ == '__main__':
    unittest.main()
