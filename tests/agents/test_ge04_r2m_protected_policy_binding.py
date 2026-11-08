"""GE-04-R2M protected-policy/custody/peer negative and consistency tests."""
import importlib.util
import json
import os
from pathlib import Path
import socket
import tempfile
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parents[2] / "scripts"


def load(file, name):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


r2i = load("ge04-r2i-issuer-custody.py", "r2m_issuer")
r2k = load("ge04-r2k-peercred-gate.py", "r2m_peer")
r2m = load("ge04-r2m-protected-policy-binding.py", "r2m_policy")


class PolicyBindingTests(unittest.TestCase):
    def setUp(self):
        if os.geteuid() == 0:
            self.skipTest("fixture intentionally unprivileged")
        self.temp = tempfile.TemporaryDirectory(prefix="ge04-r2m-", dir=str(Path.home()))
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.custody = self.root / "issuer"
        self.custody.mkdir(mode=0o700)
        self.lock = self.custody / "issuer.lock"
        self.lock.write_bytes(b"")
        self.lock.chmod(0o600)
        self.manifest_path = self.custody / "registration.json"
        self.policy_path = self.root / "policy.json"
        self.uid = os.geteuid()
        self.verifier_uid = self.uid + 10000
        self.boot = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
        self.record = {"registrationId":"reg-r2m",
                       "worker":{"coordinationRunId":"run","workerId":"w","attempt":1},
                       "process":{"pid":543,"uid":self.uid,"startTimeTicks":"987"}}
        self.manifest = {"schema":"ge04-r2h-v1","registrationId":"reg-r2m",
                         "coordinationRunId":"run","workerId":"w","attempt":1,
                         "pid":543,"uid":self.uid,"startTimeTicks":"987",
                         "bootId":self.boot,"cgroupRelative":"ge04/worker",
                         "cgroupDevice":2,"cgroupInode":99}
        self.policy = {"schema":"ge04-r2m-v1","issuerId":"issuer-test",
                       "issuerUid":self.uid,"verifierUid":self.verifier_uid,
                       "workerUid":self.uid+10001,"attackerUid":self.uid+10002,
                       "custodyDir":str(self.custody),"manifestName":"registration.json",
                       "cgroupRelative":"ge04/worker","bootId":self.boot,
                       "policyRevision":"one"}
        self.write(self.manifest_path,self.manifest)
        self.write(self.policy_path,self.policy)
        self.server,self.client = socket.socketpair(socket.AF_UNIX,socket.SOCK_STREAM)
        self.addCleanup(self.server.close)
        self.addCleanup(self.client.close)
        self.claim = {"schema":"ge04-r2k-v1","pid":os.getpid(),
                      "uid":self.uid,"gid":os.getgid(),
                      "startTimeTicks":r2k._proc_generation(os.getpid()),
                      "bootId":self.boot}

    def write(self,path,value):
        path.write_text(json.dumps(value))
        path.chmod(0o600)

    def inspect(self, *, claim=None, record=None, policy_owner_uid=None):
        # Test-fixture substitution: a same-UID process is not cross-UID proof.
        with mock.patch.object(os, "geteuid", return_value=self.verifier_uid):
            return r2m.inspect_protected_issuer_policy(
                str(self.policy_path),self.server,
                self.claim if claim is None else claim,
                self.record if record is None else record,
                policy_owner_uid=self.uid if policy_owner_uid is None else policy_owner_uid,
                custody_owner_uid=self.uid,boot_id=self.boot)

    def test_matching_consistency_still_blocked(self):
        with r2i.claim_issuer_custody(str(self.custody),"issuer-test",
                                     required_uid=self.uid):
            result=self.inspect()
        self.assertTrue(result["policyVerified"])
        self.assertTrue(result["peerVerified"])
        self.assertTrue(result["custodyVerified"])
        self.assertTrue(result["consistencyChecksPassed"])
        self.assertEqual(result["status"],"blocked")

    def test_missing_protected_policy_denied(self):
        self.policy_path.unlink()
        self.assertFalse(self.inspect()["consistencyChecksPassed"])

    def test_world_readable_policy_denied(self):
        self.policy_path.chmod(0o644)
        self.assertFalse(self.inspect()["policyVerified"])

    def test_untrusted_symlink_policy_denied(self):
        alias=self.root/"alias.json"
        alias.symlink_to(self.policy_path)
        self.policy_path=alias
        self.assertFalse(self.inspect()["policyVerified"])

    def test_stale_policy_boot_denied(self):
        self.policy["bootId"]="stale"
        self.write(self.policy_path,self.policy)
        self.assertFalse(self.inspect()["policyVerified"])

    def test_policy_uid_collision_denied(self):
        self.policy["workerUid"]=self.uid
        self.write(self.policy_path,self.policy)
        self.assertFalse(self.inspect()["policyVerified"])

    def test_peer_forged_uid_denied_even_with_custody(self):
        with r2i.claim_issuer_custody(str(self.custody),"issuer-test",
                                     required_uid=self.uid):
            result=self.inspect(claim={**self.claim,"uid":self.uid+1})
        self.assertFalse(result["peerVerified"])
        self.assertFalse(result["consistencyChecksPassed"])

    def test_stale_custody_after_crash_denied(self):
        with r2i.claim_issuer_custody(str(self.custody),"issuer-test",
                                     required_uid=self.uid):
            pass
        self.assertFalse(self.inspect()["custodyVerified"])

    def test_wrong_manifest_registration_denied(self):
        with r2i.claim_issuer_custody(str(self.custody),"issuer-test",
                                     required_uid=self.uid):
            bad={**self.record,"registrationId":"different"}
            result=self.inspect(record=bad)
        self.assertFalse(result["custodyVerified"])

    def test_missing_policy_owner_denied(self):
        self.assertFalse(self.inspect(policy_owner_uid=self.uid+1)["policyVerified"])


if __name__ == "__main__":
    unittest.main()
