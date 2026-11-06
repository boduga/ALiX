#!/usr/bin/env python3
"""Negative tests only; passing cannot qualify a supervisor or effect fence."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest

PATH = Path(__file__).with_name('ge04-q32-deny-validator.py')
spec = importlib.util.spec_from_file_location('ge04_q32_deny', PATH)
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)


class Q32DenyTests(unittest.TestCase):
    def setUp(self):
        self.expected = {k: 'fixed-' + k for k in mod.FIELDS}

    def frame(self, changes=None):
        return json.dumps({**self.expected, **(changes or {})}).encode()

    def test_match_is_still_denied(self):
        d = mod.inspect(self.frame(), self.expected)
        self.assertTrue(d.matched)
        self.assertFalse(d.authorized)
        self.assertEqual(d.response, mod.DENIED)

    def test_all_binding_fields_are_checked(self):
        for key in mod.FIELDS:
            with self.subTest(field=key):
                d = mod.inspect(self.frame({key: 'forged'}), self.expected)
                self.assertEqual(d.reason, 'binding_mismatch')
                self.assertFalse(d.authorized)

    def test_replayed_nonce_denied(self):
        d = mod.inspect(self.frame(), self.expected, claimed_nonces={self.expected['nonce']})
        self.assertEqual(d.reason, 'replay')

    def test_revoked_policy_and_approval_denied(self):
        for kwargs in ({'policy_current': False}, {'approval_current': False}):
            self.assertEqual(mod.inspect(self.frame(), self.expected, **kwargs).reason,
                             'stale_policy_or_approval')

    def test_invalid_frames_denied(self):
        bad = [b'', b'{}', b'[]', b'not json', b'\xff', b'X' * 4097,
               self.frame({'extra': 'x'}), self.frame({'nonce': 1}),
               b'{"run_id":"a","run_id":"b"}']
        for raw in bad:
            with self.subTest(raw=raw[:30]):
                self.assertEqual(mod.inspect(raw, self.expected).reason, 'malformed')

    def test_entrypoint_is_inert(self):
        result = subprocess.run([sys.executable, '-B', str(PATH)], capture_output=True,
                                text=True, timeout=5)
        self.assertEqual(result.returncode, 78)
        self.assertIn(mod.DENIED, result.stdout)


if __name__ == '__main__':
    unittest.main()
