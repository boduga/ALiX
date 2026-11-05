#!/usr/bin/env python3
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest

PATH = Path(__file__).with_name('ge04-q32-path-race-probe.py')
spec = importlib.util.spec_from_file_location('ge04_q32_path', PATH)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class PathRaceTests(unittest.TestCase):
    def test_path_reopen_is_vulnerable(self):
        self.assertTrue(mod.probe()['naive_path_followed_symlink'])

    def test_pinned_fd_preserves_original(self):
        self.assertTrue(mod.probe()['pinned_fd_preserved_original'])

    def test_nofollow_rejects_symlink(self):
        self.assertTrue(mod.probe()['nofollow_rejected_symlink'])

    def test_nofollow_does_not_prevent_regular_replacement(self):
        self.assertTrue(mod.probe()['nofollow_did_not_prevent_regular_replacement'])

    def test_no_authority_and_exit_hold(self):
        r = subprocess.run([sys.executable, '-B', str(PATH)], capture_output=True,
                           text=True, timeout=5)
        self.assertEqual(r.returncode, 78)
        payload = json.loads(r.stdout)
        self.assertEqual(payload['disposition'], 'HOLD')
        self.assertFalse(payload['qualified_independent_custody'])
        self.assertEqual(payload['response'], mod.DENIED)


if __name__ == '__main__':
    unittest.main()
