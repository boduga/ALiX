"""GE-04-R2H independent custody manifest negative tests."""
import importlib.util
import json
import os
import pathlib
import tempfile
import unittest

SOURCE = pathlib.Path(__file__).resolve().parents[2] / "scripts/ge04-r2h-recovery-manifest.py"
spec = importlib.util.spec_from_file_location("ge04_r2h", SOURCE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

RECORD = {"registrationId": "reg-a",
          "worker": {"coordinationRunId": "run", "workerId": "w", "attempt": 1},
          "process": {"pid": 456, "uid": 1000, "startTimeTicks": "100"}}
IDENTITY = {"schema": "ge04-r2h-v1", "registrationId": "reg-a",
            "coordinationRunId": "run", "workerId": "w", "attempt": 1,
            "pid": 456, "uid": 1000, "startTimeTicks": "100",
            "bootId": "boot-a", "cgroupRelative": "ge04/worker",
            "cgroupDevice": 42, "cgroupInode": 900}


class RecoveryManifestTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="ge04-r2h-", dir=str(pathlib.Path.home()))
        self.addCleanup(self.tmp.cleanup)
        self.dir = pathlib.Path(self.tmp.name)
        self.path = self.dir / "manifest.json"
        self.save(IDENTITY)

    def save(self, value):
        self.path.write_text(json.dumps(value))
        self.path.chmod(0o600)

    def verify(self, record=RECORD, *, boot_id="boot-a", relative="ge04/worker", path=None):
        return mod.verify_recovery_manifest(
            str(path or self.path), record, relative,
            boot_id=boot_id, required_uid=os.getuid())

    def test_valid_manifest_only_reaches_consistency_not_clearance(self):
        result = self.verify()
        self.assertEqual(result["status"], "blocked")
        self.assertTrue(result["manifestVerified"])
        self.assertEqual(result["expectedCgroup"]["inode"], 900)

    def test_identity_and_registration_mismatch(self):
        for field in ("registrationId", "workerId", "startTimeTicks", "pid", "attempt", "uid"):
            with self.subTest(field=field):
                modified = dict(IDENTITY)
                modified[field] = 999 if isinstance(modified[field], int) else "other"
                self.save(modified)
                self.assertFalse(self.verify()["manifestVerified"])
        self.save(IDENTITY)

    def test_stale_boot_and_cgroup_path(self):
        self.assertFalse(self.verify(boot_id="boot-b")["manifestVerified"])
        self.assertFalse(self.verify(relative="other")["manifestVerified"])

    def test_missing_or_incomplete_manifest(self):
        self.path.unlink()
        self.assertFalse(self.verify()["manifestVerified"])
        self.save({k: v for k, v in IDENTITY.items() if k != "registrationId"})
        self.assertFalse(self.verify()["manifestVerified"])

    def test_symlink_manifest_rejected(self):
        link = self.dir / "alias"
        link.symlink_to(self.path)
        self.assertFalse(self.verify(path=link)["manifestVerified"])

    def test_world_writable_or_readable_file_rejected(self):
        for mode in (0o666, 0o644, 0o620):
            with self.subTest(mode=mode):
                self.path.chmod(mode)
                self.assertFalse(self.verify()["manifestVerified"])
        self.path.chmod(0o600)

    def test_writable_parent_rejected(self):
        self.dir.chmod(0o777)
        self.assertFalse(self.verify()["manifestVerified"])
        self.dir.chmod(0o700)

    def test_wrong_owner_provenance_rejected(self):
        result = mod.verify_recovery_manifest(
            str(self.path), RECORD, "ge04/worker", boot_id="boot-a",
            required_uid=os.getuid() + 1)
        self.assertFalse(result["manifestVerified"])

    def test_invalid_schema_and_extra_fields(self):
        self.save({**IDENTITY, "authorized": True})
        self.assertFalse(self.verify()["manifestVerified"])
        self.save({**IDENTITY, "schema": "ge04-r2h-v2"})
        self.assertFalse(self.verify()["manifestVerified"])

    def test_malformed_json_and_hardlink_rejected(self):
        self.path.write_text("{bad}")
        self.assertFalse(self.verify()["manifestVerified"])
        self.save(IDENTITY)
        extra = self.dir / "second"
        os.link(self.path, extra)
        self.assertFalse(self.verify()["manifestVerified"])


if __name__ == "__main__":
    unittest.main()
