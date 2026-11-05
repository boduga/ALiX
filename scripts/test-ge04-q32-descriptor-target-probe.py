#!/usr/bin/env python3
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest

PATH = Path(__file__).with_name('ge04-q32-descriptor-target-probe.py')
spec = importlib.util.spec_from_file_location('q32_descriptor', PATH)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class DescriptorTests(unittest.TestCase):
    def test_identity_before_replacement(self):
        self.assertTrue(mod.probe()['initial_identity_matched'])

    def test_regular_replacement_detected(self):
        self.assertTrue(mod.probe()['regular_replacement_rejected'])

    def test_original_descriptor_remains_pinned(self):
        self.assertTrue(mod.probe()['pinned_original_preserved'])

    def test_symlink_and_traversal_rejected(self):
        result = mod.probe()
        self.assertTrue(result['symlink_rejected'])
        self.assertTrue(result['traversal_rejected'])

    def test_always_hold(self):
        p = subprocess.run([sys.executable, '-B', str(PATH)], capture_output=True,
                           text=True, timeout=5)
        self.assertEqual(p.returncode, 78)
        result = json.loads(p.stdout)
        self.assertFalse(result['qualified_effect_fence'])
        self.assertEqual(result['response'], mod.DENIED)


if __name__ == '__main__':
    unittest.main()
