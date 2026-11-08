"""R2R verifier-held exact floor: signed rollback and key-substitution negatives."""
import importlib.util
import hashlib
from pathlib import Path
import unittest

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

ROOT = Path(__file__).resolve().parents[2] / "scripts"


def load(file, alias):
    spec = importlib.util.spec_from_file_location(alias, ROOT / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


floor_mod = load("ge04-r2r-external-floor-check.py", "r2r_floor")
receipt_mod = load("ge04-r2p-external-witness-receipt.py", "r2r_receipt_test")


class FloorConsistencyTests(unittest.TestCase):
    def setUp(self):
        self.key = Ed25519PrivateKey.generate()
        self.pub = self.key.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        self.floor = {
            "schema": "ge04-r2r-floor-v1",
            "witnessId": "alix-ge04-r2q-qualifier",
            "publicKeySha256": hashlib.sha256(self.pub).hexdigest(),
            "minimumRevision": 2,
            "policySha256": "a" * 64,
            "checkpointSha256": "b" * 64,
            "trustStatus": "operator-unverified",
        }
        self.nonce = "c" * 64
        self.boot = "boot-test"

    def signed(self, revision=2, policy="a"*64, checkpoint="b"*64,
               nonce=None, witness="alix-ge04-r2q-qualifier"):
        body = {"schema": "ge04-r2p-witness-v1", "witnessId": witness,
                "nonce": nonce or self.nonce, "revision": str(revision),
                "policySha256": policy, "checkpointSha256": checkpoint,
                "bootId": self.boot}
        return {"payload": body, "signature":
                self.key.sign(receipt_mod.canonical_bytes(body)).hex()}

    def inspect(self, receipt=None, floor=None, pub=None):
        return floor_mod.assess_floor(
            self.signed() if receipt is None else receipt,
            self.floor if floor is None else floor,
            public_key=self.pub if pub is None else pub,
            challenge_nonce=self.nonce, boot_id=self.boot)

    def test_matching_signed_exact_floor_still_blocked(self):
        result = self.inspect()
        self.assertTrue(result["floorConsistent"])
        self.assertTrue(result["signatureVerified"])
        self.assertFalse(result["witnessAuthorityQualified"])
        self.assertFalse(result["rollbackResistant"])
        self.assertEqual(result["status"], "blocked")

    def test_signed_rollback_below_floor_rejected(self):
        result = self.inspect(self.signed(revision=1))
        self.assertTrue(result["signatureVerified"])
        self.assertFalse(result["floorConsistent"])

    def test_future_revision_without_floor_advancement_rejected(self):
        result = self.inspect(self.signed(revision=3))
        self.assertFalse(result["floorConsistent"])

    def test_key_substitution_rejected(self):
        other = Ed25519PrivateKey.generate()
        forged_pub = other.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        result = self.inspect(pub=forged_pub)
        self.assertFalse(result["floorConsistent"])
        self.assertFalse(result["signatureVerified"])

    def test_wrong_policy_digest_denied(self):
        self.assertFalse(self.inspect(self.signed(policy="f"*64))["floorConsistent"])

    def test_wrong_checkpoint_digest_denied(self):
        self.assertFalse(self.inspect(self.signed(checkpoint="f"*64))["floorConsistent"])

    def test_replayed_nonce_denied(self):
        self.assertFalse(self.inspect(self.signed(nonce="f"*64))["floorConsistent"])

    def test_wrong_witness_identity_denied(self):
        self.assertFalse(self.inspect(self.signed(witness="rogue"))["floorConsistent"])

    def test_unsigned_or_tampered_receipt_denied(self):
        forged = self.signed()
        forged["payload"] = {**forged["payload"], "revision": "1"}
        self.assertFalse(self.inspect(forged)["floorConsistent"])

    def test_floor_without_trusted_provenance_remains_hold(self):
        original = dict(self.floor)
        self.floor["trustStatus"] = "qualified"
        self.assertFalse(self.inspect()["floorConsistent"])
        self.floor = original
        self.assertTrue(self.inspect()["floorConsistent"])
        self.assertFalse(self.inspect()["rollbackResistant"])

    def test_bool_revision_and_unknown_field_denied(self):
        for update in ({"minimumRevision": True}, {"extra": "yes"}):
            with self.subTest(update=update):
                self.assertFalse(self.inspect(floor={**self.floor, **update})["floorConsistent"])


if __name__ == "__main__":
    unittest.main()
