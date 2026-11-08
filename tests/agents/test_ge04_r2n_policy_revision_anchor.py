"""GE-04-R2N revision-anchor fail-closed tests.

The positive check mocks root-owned anchor reads; it does NOT prove independent
publisher provenance. Production qualification remains on hold.
"""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

SRC = Path(__file__).resolve().parents[2] / "scripts/ge04-r2n-policy-revision-anchor.py"
spec = importlib.util.spec_from_file_location("ge04_r2n", SRC)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class RevisionAnchorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="ge04-r2n-", dir=str(Path.home()))
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.policy_dir = root / "policy"
        self.anchor_dir = root / "anchor"
        self.policy_dir.mkdir(mode=0o700)
        self.anchor_dir.mkdir(mode=0o700)
        self.policy_path = self.policy_dir / "policy.json"
        self.anchor_path = self.anchor_dir / "anchor.json"
        self.uid = os.geteuid()
        self.boot = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
        self.policy = {
            "schema": "ge04-r2m-v1", "issuerId": "issuer-a",
            "issuerUid": self.uid, "verifierUid": self.uid + 1000,
            "workerUid": self.uid + 1001, "attackerUid": self.uid + 1002,
            "custodyDir": str(root / "custody"), "manifestName": "reg.json",
            "cgroupRelative": "ge04/w", "bootId": self.boot,
            "policyRevision": "7",
        }
        self.anchor = {
            "schema": "ge04-r2n-v1", "policyRevision": "7",
            "policySha256": mod.canonical_digest(self.policy),
            "policyBootId": self.boot,
            "issuerUid": self.uid, "issuerId": "issuer-a",
        }
        self.write()

    def write(self):
        for path, value in ((self.policy_path, self.policy),
                            (self.anchor_path, self.anchor)):
            path.write_text(json.dumps(value))
            path.chmod(0o600)

    def check(self, *, anchor_owner=None, mock_root=False):
        kwargs = {"policy_owner_uid": self.uid,
                  "anchor_owner_uid": self.uid if anchor_owner is None else anchor_owner,
                  "boot_id": self.boot}
        if mock_root:
            original = mod._R2H._read_manifest
            def read(path, *, required_uid=0):
                # Mock only the anchor owner of a separate protected path.
                if path == str(self.anchor_path) and required_uid == 0:
                    return original(path, required_uid=self.uid)
                return original(path, required_uid=required_uid)
            with mock.patch.object(mod._R2H, "_read_manifest", side_effect=read):
                return mod.inspect_policy_revision(self.policy_path, self.anchor_path, **kwargs)
        return mod.inspect_policy_revision(self.policy_path, self.anchor_path, **kwargs)

    def test_same_uid_anchor_has_no_provenance(self):
        result = self.check()
        self.assertFalse(result["revisionPinned"])
        self.assertFalse(result["policyProvenanceQualified"])
        self.assertEqual(result["status"], "blocked")

    def test_mocked_separate_owner_consistency_remains_blocked(self):
        result = self.check(anchor_owner=0, mock_root=True)
        self.assertTrue(result["revisionPinned"])
        self.assertEqual(result["status"], "blocked")
        self.assertFalse(result["policyProvenanceQualified"])

    def test_revision_rollback_denied(self):
        self.policy["policyRevision"] = "6"
        self.write()
        self.assertFalse(self.check()["revisionPinned"])

    def test_unanchored_future_revision_denied(self):
        self.policy["policyRevision"] = "8"
        self.write()
        self.assertFalse(self.check()["revisionPinned"])

    def test_same_revision_content_conflict_denied(self):
        self.policy["issuerId"] = "issuer-b"
        self.write()
        self.assertFalse(self.check()["revisionPinned"])

    def test_digest_tamper_denied(self):
        self.anchor["policySha256"] = "0" * 64
        self.write()
        self.assertFalse(self.check()["revisionPinned"])

    def test_stale_boot_denied(self):
        self.anchor["policyBootId"] = "old-boot"
        self.write()
        self.assertFalse(self.check()["revisionPinned"])

    def test_wrong_owner_uid_denied(self):
        self.assertFalse(self.check(anchor_owner=self.uid + 4)["revisionPinned"])

    def test_anchor_symlink_denied(self):
        alias = self.anchor_dir / "alias.json"
        alias.symlink_to(self.anchor_path)
        self.anchor_path = alias
        self.assertFalse(self.check()["revisionPinned"])

    def test_world_readable_anchor_denied(self):
        self.anchor_path.chmod(0o644)
        self.assertFalse(self.check()["revisionPinned"])

    def test_parent_permission_tamper_denied(self):
        self.anchor_dir.chmod(0o777)
        self.assertFalse(self.check()["revisionPinned"])
        self.anchor_dir.chmod(0o700)

    def test_invalid_revision_zero_and_text_denied(self):
        for version in ("0", "one", "07", "", -1):
            with self.subTest(version=version):
                self.policy["policyRevision"] = version
                self.write()
                self.assertFalse(self.check()["revisionPinned"])

    def test_same_directory_denied(self):
        self.anchor_path = self.policy_dir / "anchor.json"
        self.write()
        self.assertFalse(self.check()["revisionPinned"])

    def test_missing_anchor_denied(self):
        self.anchor_path.unlink()
        self.assertFalse(self.check()["revisionPinned"])

    def test_combined_gate_skips_r2m_without_anchor(self):
        result = mod.inspect_anchored_issuer_policy(
            str(self.policy_path), str(self.anchor_path),
            None, {}, {}, policy_owner_uid=self.uid,
            anchor_owner_uid=self.uid, boot_id=self.boot)
        self.assertFalse(result["combinedConsistency"])
        self.assertEqual(result["status"], "blocked")

    def test_read_change_during_observation_denied(self):
        orig = mod._R2H._read_manifest
        calls = {"policy": 0}
        def read(path, *, required_uid=0):
            data = orig(path, required_uid=required_uid)
            if path == str(self.policy_path):
                calls["policy"] += 1
                if calls["policy"] == 2:
                    return {**data, "issuerId": "swapped"}
            return data
        with mock.patch.object(mod._R2H, "_read_manifest", side_effect=read):
            result = self.check()
        self.assertFalse(result["revisionPinned"])
        self.assertIn("policy or anchor replaced during observation", result["reasons"])


if __name__ == "__main__":
    unittest.main()
