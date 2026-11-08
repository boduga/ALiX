"""R2R trust readiness must never issue security clearance."""
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "r2r_preflight", ROOT / "scripts/ge04-r2r-trust-preflight.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
pin = json.loads((ROOT / "docs/audits/evidence/ge04/r2r-qualification-witness-pin.json").read_text())
COMMANDS = {"tpm2_getcap": True, "tpm2_nvread": True,
            "tpm2_nvreadpublic": True, "tpm2_nvincrement": True}


class TrustReadinessTests(unittest.TestCase):
    def test_missing_tools_blocks(self):
        checks = dict(COMMANDS)
        checks["tpm2_nvreadpublic"] = False
        verdict = module.assess(pin=pin, tpm_version="2", utilities=checks)
        self.assertIn("tpmToolsAvailable", verdict["unresolved"])
        self.assertFalse(verdict["rollbackResistant"])

    def test_no_tpm_blocks(self):
        verdict = module.assess(pin=pin, tpm_version=None, utilities=COMMANDS)
        self.assertFalse(verdict["readinessChecks"]["tpm2DeviceDetected"])

    def test_key_not_independently_verified_blocks(self):
        verdict = module.assess(pin=pin, tpm_version="2", utilities=COMMANDS)
        self.assertFalse(verdict["readinessChecks"]["operatorKeyProvenanceVerified"])
        self.assertEqual(verdict["status"], "blocked")

    def test_no_provisioned_counter_blocks(self):
        verdict = module.assess(pin=pin, tpm_version="2", utilities=COMMANDS,
                                operator_attestation=True)
        self.assertFalse(verdict["readinessChecks"]["independentCounterProvisioned"])

    def test_all_declared_inputs_still_not_authorization(self):
        verdict = module.assess(pin=pin, tpm_version="2", utilities=COMMANDS,
                                operator_attestation=True,
                                tpm_counter_provisioned=True,
                                counter_binding_verified=True)
        self.assertEqual(verdict["status"], "blocked")
        self.assertFalse(verdict["independentAuthorityQualified"])
        self.assertFalse(verdict["rollbackResistant"])
        self.assertTrue(verdict["securityHoldActive"])


if __name__ == "__main__":
    unittest.main()
