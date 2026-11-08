"""R2R local qualification pin tests; no production trust assertion."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"
spec = importlib.util.spec_from_file_location("r2r_probe", SCRIPTS / "ge04-r2q-cross-host-probe.py")
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)
PIN = Path(__file__).resolve().parents[2] / "docs/audits/evidence/ge04/r2r-qualification-witness-pin.json"


class QualificationPinTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "pin.json"
        self.pin = json.loads(PIN.read_text())
        self.write()

    def write(self):
        self.path.write_text(json.dumps(self.pin))

    def test_snapshot_load_is_explicitly_unverified(self):
        result = probe.load_qualification_pin(self.path)
        self.assertEqual(result["trustStatus"], "unverified-operator-pin")
        self.assertFalse(result["authorization"])

    def test_wrong_host_denied(self):
        self.pin["host"] = "10.1.1.22"
        self.write()
        with self.assertRaises(ValueError):
            probe.load_qualification_pin(self.path)

    def test_unknown_field_denied(self):
        self.pin["authorized"] = True
        self.write()
        with self.assertRaises(ValueError):
            probe.load_qualification_pin(self.path)

    def test_fake_qualified_status_denied(self):
        self.pin["trustStatus"] = "qualified"
        self.write()
        with self.assertRaises(ValueError):
            probe.load_qualification_pin(self.path)

    def test_invalid_revision_denied(self):
        for value in (0, -1, "1", True):
            with self.subTest(value=value):
                self.pin["revision"] = value
                self.write()
                with self.assertRaises(ValueError):
                    probe.load_qualification_pin(self.path)

    def test_invalid_pubkey_denied(self):
        self.pin["publicKeyHex"] = "0" * 63
        self.write()
        with self.assertRaises(ValueError):
            probe.load_qualification_pin(self.path)

    def test_invalid_digest_denied(self):
        self.pin["checkpointSha256"] = "Z" * 64
        self.write()
        with self.assertRaises(ValueError):
            probe.load_qualification_pin(self.path)

    def test_missing_manifest_denied(self):
        self.path.unlink()
        with self.assertRaises(FileNotFoundError):
            probe.load_qualification_pin(self.path)


if __name__ == "__main__":
    unittest.main()
