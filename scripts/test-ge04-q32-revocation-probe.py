#!/usr/bin/env python3
import concurrent.futures
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

PATH = Path(__file__).with_name('ge04-q32-revocation-probe.py')
spec = importlib.util.spec_from_file_location('q32_revoke', PATH)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def check(path):
    return mod.RevocationProbe(Path(path)).final_check('shared', 1)


def revoke(path):
    return mod.RevocationProbe(Path(path)).revoke()


class RevocationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'synthetic.sqlite'
        self.store = mod.RevocationProbe(self.path)
        self.store.initialize()

    def test_match_never_authorizes(self):
        r = self.store.final_check('a', 1)
        self.assertTrue(r['matched'])
        self.assertFalse(r['authorized'])

    def test_revoke_before_check_denies(self):
        self.assertTrue(self.store.revoke())
        self.assertEqual(self.store.final_check('a', 1)['reason'], 'revoked_or_stale')

    def test_replay_denies(self):
        self.assertTrue(self.store.final_check('a', 1)['matched'])
        self.assertEqual(self.store.final_check('a', 1)['reason'], 'replay')

    def test_stale_revision_denies(self):
        self.assertEqual(self.store.final_check('a', 2)['reason'], 'revoked_or_stale')

    def test_concurrent_revoke_and_check_serialized(self):
        with concurrent.futures.ProcessPoolExecutor(max_workers=2) as pool:
            f = pool.submit(check, str(self.path))
            g = pool.submit(revoke, str(self.path))
            result = f.result(timeout=10)
            self.assertTrue(g.result(timeout=10))
        self.assertFalse(result['authorized'])
        self.assertEqual(self.store.final_check('new', 1)['reason'], 'revoked_or_stale')

    def test_missing_store_fails_closed(self):
        self.path.unlink()
        self.assertEqual(self.store.final_check('a', 1)['reason'], 'store_unavailable')

    def test_entrypoint_denies(self):
        p = subprocess.run([sys.executable, '-B', str(PATH)], capture_output=True, text=True, timeout=5)
        self.assertEqual(p.returncode, 78)
        self.assertFalse(json.loads(p.stdout)['authorized'])


if __name__ == '__main__':
    unittest.main()
