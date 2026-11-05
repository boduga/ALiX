#!/usr/bin/env python3
"""Q3.2 disposable storage atomicity tests; NOT authorization tests."""
import concurrent.futures
import importlib.util
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

PATH = Path(__file__).with_name('ge04-q32-claim-probe.py')
spec = importlib.util.spec_from_file_location('ge04_q32_claim', PATH)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def claim_once(path, nonce, binding):
    return mod.ClaimProbe(Path(path)).claim(nonce, binding)


class ClaimTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='alix-q32-claim-')
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'test-only.sqlite'
        self.store = mod.ClaimProbe(self.path)
        self.store.initialize()
        self.binding = {'attempt_id': 'attempt-1', 'capability': 'none'}

    def test_replay_after_reopen_is_denied(self):
        self.assertTrue(self.store.claim('nonce-1', self.binding))
        self.assertFalse(mod.ClaimProbe(self.path).claim('nonce-1', self.binding))

    def test_same_nonce_cannot_be_rebound(self):
        self.assertTrue(self.store.claim('nonce-1', self.binding))
        self.assertFalse(self.store.claim('nonce-1', {'attempt_id': 'forged'}))

    def test_two_processes_at_most_one_wins(self):
        with concurrent.futures.ProcessPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(claim_once, str(self.path), 'same-nonce', self.binding)
                       for _ in range(2)]
            outcomes = [f.result(timeout=10) for f in futures]
        self.assertEqual(sorted(outcomes), [False, True])

    def test_corrupt_or_missing_store_fails_closed(self):
        self.path.unlink()
        self.assertFalse(self.store.claim('nonce', self.binding))
        self.path.write_bytes(b'not a sqlite database')
        self.assertFalse(self.store.claim('nonce', self.binding))

    def test_invalid_nonce_rejected(self):
        for nonce in ('', 'a' * 257, None):
            self.assertFalse(self.store.claim(nonce, self.binding))

    def test_entrypoint_is_inert(self):
        r = subprocess.run([sys.executable, '-B', str(PATH)], capture_output=True,
                           text=True, timeout=5)
        self.assertEqual(r.returncode, 78)
        self.assertIn('DENIED GE04_SECURITY_HOLD', r.stdout)


if __name__ == '__main__':
    unittest.main()
