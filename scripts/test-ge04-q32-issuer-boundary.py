#!/usr/bin/env python3
import dataclasses
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest

PATH = Path(__file__).with_name('ge04-q32-issuer-boundary.py')
spec = importlib.util.spec_from_file_location('q32_issuer', PATH)
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

BASE = mod.Boundary(991, 995, 994, 993, 991, 991, 995, 0o600, 0o600, 0o600)


class BoundaryTests(unittest.TestCase):
    def test_clean_facts_still_hold(self):
        result = mod.inspect_boundary(BASE)
        self.assertTrue(result['synthetic_separation_checks_passed'])
        self.assertFalse(result['qualified_independent_issuance'])

    def test_issuer_same_as_coordinator(self):
        r = mod.inspect_boundary(dataclasses.replace(BASE, issuer_uid=994))
        self.assertIn('identities_not_four_distinct_nonroot_uids', r['reasons'])

    def test_issuer_same_as_supervisor(self):
        r = mod.inspect_boundary(dataclasses.replace(BASE, issuer_uid=995))
        self.assertIn('identities_not_four_distinct_nonroot_uids', r['reasons'])

    def test_coordinator_owns_policy(self):
        r = mod.inspect_boundary(dataclasses.replace(BASE, policy_store_owner_uid=994))
        self.assertIn('policy_store_owner_mismatch', r['reasons'])

    def test_coordinator_owns_issuer_store(self):
        r = mod.inspect_boundary(dataclasses.replace(BASE, issuer_store_owner_uid=994))
        self.assertIn('issuer_store_owner_mismatch', r['reasons'])

    def test_coordinator_owns_claims(self):
        r = mod.inspect_boundary(dataclasses.replace(BASE, claims_store_owner_uid=994))
        self.assertIn('claims_store_owner_mismatch', r['reasons'])

    def test_world_readable_store(self):
        r = mod.inspect_boundary(dataclasses.replace(BASE, issuer_store_mode=0o644))
        self.assertIn('issuer_store_mode_not_private', r['reasons'])

    def test_root_or_invalid_identity(self):
        r = mod.inspect_boundary(dataclasses.replace(BASE, issuer_uid=0))
        self.assertIn('identities_not_four_distinct_nonroot_uids', r['reasons'])

    def test_entrypoint_denies(self):
        p = subprocess.run([sys.executable, '-B', str(PATH)], capture_output=True,
                           text=True, timeout=5)
        self.assertEqual(p.returncode, 78)
        self.assertFalse(json.loads(p.stdout)['qualified_independent_issuance'])


if __name__ == '__main__':
    unittest.main()
