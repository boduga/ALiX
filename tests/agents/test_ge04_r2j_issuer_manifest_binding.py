"""GE-04-R2J issuer/manifest binding regression tests (no authorization)."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

_SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"


def load(script, module_name):
    spec = importlib.util.spec_from_file_location(module_name, _SCRIPTS / script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


r2i = load("ge04-r2i-issuer-custody.py", "r2i_custody_r2j_test")
r2j = load("ge04-r2j-issuer-manifest-binding.py", "r2j_binding_test")


class IssuerBindingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="ge04-r2j-", dir=str(Path.home()))
        self.addCleanup(self.temp.cleanup)
        self.dir = Path(self.temp.name) / "custody"
        self.dir.mkdir(mode=0o700)
        self.lock = self.dir / "issuer.lock"
        self.lock.write_bytes(b"")
        self.lock.chmod(0o600)
        self.path = self.dir / "registration.json"
        self.uid = os.geteuid()
        self.boot = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
        self.record = {
            "registrationId": "reg-a",
            "worker": {"coordinationRunId": "run", "workerId": "worker", "attempt": 2},
            "process": {"pid": 432, "uid": 1000, "startTimeTicks": "98765"},
        }
        self.manifest = {
            "schema": "ge04-r2h-v1", "registrationId": "reg-a",
            "coordinationRunId": "run", "workerId": "worker", "attempt": 2,
            "pid": 432, "uid": 1000, "startTimeTicks": "98765",
            "bootId": self.boot, "cgroupRelative": "ge04/leaf",
            "cgroupDevice": 17, "cgroupInode": 800,
        }
        self.save_manifest()

    def save_manifest(self):
        self.path.write_text(json.dumps(self.manifest))
        self.path.chmod(0o600)

    def inspect(self, *, record=None, relative="ge04/leaf", owner="issuer-a",
                boot_id=None, manifest_name="registration.json"):
        return r2j.inspect_issuer_manifest_binding(
            str(self.dir), manifest_name, self.record if record is None else record,
            relative, owner, required_uid=self.uid,
            boot_id=self.boot if boot_id is None else boot_id)

    def claim(self):
        return r2i.claim_issuer_custody(str(self.dir), "issuer-a", required_uid=self.uid)

    def test_matching_live_custody_manifest_only_passes_consistency(self):
        with self.claim():
            result = self.inspect()
        self.assertEqual(result["status"], "blocked")
        self.assertTrue(result["consistencyChecksPassed"])
        self.assertTrue(result["issuerGenerationMatches"])
        self.assertTrue(result["manifestMatches"])
        self.assertTrue(result["lockContended"])
        self.assertNotIn("authorizedForWorkerLaunch", result)

    def test_absent_claim_denied(self):
        result = self.inspect()
        self.assertFalse(result["consistencyChecksPassed"])
        self.assertEqual(result["status"], "blocked")

    def test_stale_claim_after_owner_exits_denied(self):
        with self.claim():
            pass
        result = self.inspect()
        self.assertFalse(result["lockContended"])
        self.assertFalse(result["consistencyChecksPassed"])

    def test_wrong_issuer_id_denied(self):
        with self.claim():
            result = self.inspect(owner="someone-else")
        self.assertFalse(result["consistencyChecksPassed"])

    def test_stale_boot_generation_denied(self):
        with self.claim():
            result = self.inspect(boot_id="stale-boot")
        self.assertFalse(result["issuerGenerationMatches"])
        self.assertFalse(result["consistencyChecksPassed"])

    def test_wrong_worker_registration_denied(self):
        with self.claim():
            record = {**self.record, "registrationId": "other"}
            result = self.inspect(record=record)
        self.assertFalse(result["manifestMatches"])
        self.assertFalse(result["consistencyChecksPassed"])

    def test_wrong_cgroup_denied(self):
        with self.claim():
            result = self.inspect(relative="another/cgroup")
        self.assertFalse(result["manifestMatches"])
        self.assertFalse(result["consistencyChecksPassed"])

    def test_missing_manifest_denied(self):
        with self.claim():
            result = self.inspect(manifest_name="not-here.json")
        self.assertFalse(result["consistencyChecksPassed"])

    def test_symlink_manifest_denied(self):
        (self.dir / "alias.json").symlink_to(self.path)
        with self.claim():
            result = self.inspect(manifest_name="alias.json")
        self.assertFalse(result["consistencyChecksPassed"])

    def test_world_readable_manifest_denied(self):
        self.path.chmod(0o644)
        with self.claim():
            result = self.inspect()
        self.assertFalse(result["consistencyChecksPassed"])

    def test_wrong_custody_parent_permissions_denied(self):
        self.dir.parent.chmod(0o777)
        with self.assertRaises(r2i.CustodyDenied):
            self.claim()
        result = self.inspect()
        self.assertFalse(result["consistencyChecksPassed"])
        self.dir.parent.chmod(0o700)

    def test_claim_process_generation_mismatch_denied(self):
        with self.claim():
            claim = self.dir / "issuer.claim"
            payload = json.loads(claim.read_text())
            payload["startTimeTicks"] = "99999999999"
            claim.write_text(json.dumps(payload))
            claim.chmod(0o600)
            result = self.inspect()
        self.assertFalse(result["issuerGenerationMatches"])
        self.assertFalse(result["consistencyChecksPassed"])

    def test_legacy_claim_schema_denied(self):
        with self.claim():
            claim = self.dir / "issuer.claim"
            payload = json.loads(claim.read_text())
            payload["schema"] = "ge04-r2i-v1"
            claim.write_text(json.dumps(payload))
            claim.chmod(0o600)
            result = self.inspect()
        self.assertFalse(result["consistencyChecksPassed"])

    def test_unsafe_manifest_name_denied(self):
        with self.claim():
            result = self.inspect(manifest_name="../registration.json")
        self.assertFalse(result["consistencyChecksPassed"])


if __name__ == "__main__":
    unittest.main()
