"""GE-04-R2O fail-closed publisher-chain tests (no privileged authority)."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

SOURCE = Path(__file__).resolve().parents[2] / "scripts/ge04-r2o-publisher-chain.py"
spec = importlib.util.spec_from_file_location("ge04_r2o", SOURCE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class PublisherChainTests(unittest.TestCase):
    def setUp(self):
        if os.geteuid() == 0:
            self.skipTest("unprivileged fixture required")
        self.temp = tempfile.TemporaryDirectory(
            prefix="ge04-r2o-", dir=str(Path.home()))
        self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name)
        self.jdir = base / "publisher"
        self.cdir = base / "checkpoint"
        self.jdir.mkdir(mode=0o700)
        self.cdir.mkdir(mode=0o700)
        self.journal = self.jdir / "journal.json"
        self.checkpoint = self.cdir / "checkpoint.json"
        self.uid = os.geteuid()
        self.boot = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
        self.entries = []
        self.append(1)
        self.append(2)
        self.write()

    def append(self, revision):
        prev = (mod._GENESIS if not self.entries else
                mod._sha256(mod._canonical(self.entries[-1])))
        self.entries.append({
            "schema": "ge04-r2o-entry-v1", "revision": revision,
            "policySha256": mod._sha256(("policy-%s" % revision).encode()),
            "previousEntrySha256": prev,
            "publisherUid": self.uid,
            "issuerUid": self.uid + 111,
            "issuerId": "issuer-one", "bootId": self.boot,
        })

    def write(self):
        self.anchor = {
            "schema": "ge04-r2o-checkpoint-v1",
            "revision": len(self.entries),
            "entrySha256": mod._sha256(mod._canonical(self.entries[-1])),
            "policySha256": self.entries[-1]["policySha256"],
            "publisherUid": self.uid, "bootId": self.boot,
        }
        for path, value in ((self.journal, self.entries),
                            (self.checkpoint, self.anchor)):
            path.write_text(json.dumps(value))
            path.chmod(0o600)

    def check(self, *, mock_checkpoint_owner=True):
        # Only simulated root checkpoint ownership: NOT a real trusted store.
        original = mod._read_journal
        def read(path, uid):
            if mock_checkpoint_owner and str(path) == str(self.checkpoint) and uid == 0:
                return original(path, self.uid)
            return original(path, uid)
        with mock.patch.object(mod, "_read_journal", side_effect=read):
            return mod.inspect_publisher_chain(
                str(self.journal), str(self.checkpoint),
                publisher_uid=self.uid, checkpoint_uid=0, boot_id=self.boot)

    def test_matching_mocked_checkpoint_is_not_authority(self):
        result = self.check()
        self.assertTrue(result["journalConsistent"])
        self.assertTrue(result["checkpointMatches"])
        self.assertFalse(result["publisherProvenanceQualified"])
        self.assertFalse(result["rollbackResistant"])
        self.assertEqual(result["status"], "blocked")

    def test_real_same_uid_checkpoint_cannot_qualify(self):
        result = mod.inspect_publisher_chain(
            str(self.journal), str(self.checkpoint),
            publisher_uid=self.uid, checkpoint_uid=self.uid, boot_id=self.boot)
        self.assertFalse(result["journalConsistent"])

    def test_missing_checkpoint_denied(self):
        self.checkpoint.unlink()
        self.assertFalse(self.check()["checkpointMatches"])

    def test_world_readable_checkpoint_denied(self):
        self.checkpoint.chmod(0o644)
        self.assertFalse(self.check()["checkpointMatches"])

    def test_symlink_checkpoint_denied(self):
        link = self.cdir / "linked.json"
        link.symlink_to(self.checkpoint)
        self.checkpoint = link
        self.assertFalse(self.check()["checkpointMatches"])

    def test_stale_checkpoint_revision_denied(self):
        self.anchor["revision"] = 1
        self.checkpoint.write_text(json.dumps(self.anchor))
        self.assertFalse(self.check()["checkpointMatches"])

    def test_stale_journal_revision_denied(self):
        self.entries[1]["revision"] = 1
        self.journal.write_text(json.dumps(self.entries))
        self.assertFalse(self.check()["journalConsistent"])

    def test_skipped_revision_denied(self):
        self.entries[1]["revision"] = 3
        self.journal.write_text(json.dumps(self.entries))
        self.assertFalse(self.check()["journalConsistent"])

    def test_entry_tamper_rejected(self):
        self.entries[0]["issuerId"] = "forged"
        self.journal.write_text(json.dumps(self.entries))
        self.assertFalse(self.check()["journalConsistent"])

    def test_forged_publisher_uid_denied(self):
        self.entries[0]["publisherUid"] = self.uid + 50
        self.journal.write_text(json.dumps(self.entries))
        self.assertFalse(self.check()["journalConsistent"])

    def test_stale_boot_denied(self):
        self.anchor["bootId"] = "previous-boot"
        self.checkpoint.write_text(json.dumps(self.anchor))
        self.assertFalse(self.check()["checkpointMatches"])

    def test_conflicting_digest_denied(self):
        self.anchor["policySha256"] = "f" * 64
        self.checkpoint.write_text(json.dumps(self.anchor))
        self.assertFalse(self.check()["checkpointMatches"])

    def test_checkpoint_content_replacement_denied(self):
        original = mod._read_journal
        reads = {"count": 0}
        def read(path, uid):
            data = original(path, self.uid if uid == 0 else uid)
            if str(path) == str(self.checkpoint):
                reads["count"] += 1
                if reads["count"] == 2:
                    return {**data, "revision": 99}
            return data
        with mock.patch.object(mod, "_read_journal", side_effect=read):
            result = mod.inspect_publisher_chain(
                str(self.journal), str(self.checkpoint),
                publisher_uid=self.uid, checkpoint_uid=0, boot_id=self.boot)
        self.assertFalse(result["checkpointMatches"])

    def test_coordinated_rollback_cannot_be_detected_without_external_counter(self):
        # Demonstrates the unresolved threat, not a passing security property.
        self.entries = self.entries[:1]
        self.write()
        result = self.check()
        self.assertTrue(result["journalConsistent"])
        self.assertTrue(result["checkpointMatches"])
        self.assertFalse(result["rollbackResistant"])
        self.assertFalse(result["publisherProvenanceQualified"])
        self.assertEqual(result["status"], "blocked")

    def test_missing_external_chain_skips_policy(self):
        self.checkpoint.unlink()
        result = mod.inspect_publisher_policy_binding(
            str(self.journal), str(self.checkpoint), "/missing/policy",
            "/missing/anchor", publisher_uid=self.uid,
            checkpoint_uid=0, policy_owner_uid=self.uid, boot_id=self.boot)
        self.assertFalse(result["policyMatched"])
        self.assertFalse(result["qualified"])
        self.assertEqual(result["status"], "blocked")


if __name__ == "__main__":
    unittest.main()
