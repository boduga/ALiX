"""R2P signed witness receipt tests; synthetic Ed25519 keys are NOT authority."""
import importlib.util
from pathlib import Path
import unittest

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

SOURCE = Path(__file__).resolve().parents[2] / "scripts/ge04-r2p-external-witness-receipt.py"
spec = importlib.util.spec_from_file_location("ge04_r2p", SOURCE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

NONCE = "a" * 64
HEAD = "b" * 64
POLICY = "c" * 64


class WitnessReceiptTests(unittest.TestCase):
    def setUp(self):
        self.key = Ed25519PrivateKey.generate()
        self.pub = self.key.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        self.payload = {
            "schema": "ge04-r2p-witness-v1", "witnessId": "test-witness",
            "nonce": NONCE, "revision": "3",
            "checkpointSha256": HEAD, "policySha256": POLICY,
            "bootId": "test-boot",
        }

    def make_receipt(self, payload=None):
        body = self.payload if payload is None else payload
        return {"payload": body,
                "signature": self.key.sign(mod.canonical_bytes(body)).hex()}

    def verify(self, receipt=None, **overrides):
        kwargs = {
            "trusted_public_key": self.pub, "challenge_nonce": NONCE,
            "witness_id": "test-witness", "checkpoint_digest": HEAD,
            "policy_digest": POLICY, "revision": 3,
            "minimum_revision": 3, "boot_id": "test-boot",
        }
        kwargs.update(overrides)
        return mod.verify_witness_receipt(
            self.make_receipt() if receipt is None else receipt, **kwargs)

    def test_valid_signature_matches_but_never_qualifies_witness(self):
        result = self.verify()
        self.assertTrue(result["signatureVerified"])
        self.assertTrue(result["freshChallengeMatched"])
        self.assertTrue(result["headMatched"])
        self.assertFalse(result["witnessAuthorityQualified"])
        self.assertFalse(result["rollbackResistant"])
        self.assertEqual(result["status"], "blocked")

    def test_tampered_payload_fails_signature(self):
        receipt = self.make_receipt()
        receipt["payload"] = {**receipt["payload"], "revision": "4"}
        self.assertFalse(self.verify(receipt)["signatureVerified"])

    def test_wrong_pinned_key_fails(self):
        other = Ed25519PrivateKey.generate()
        pub = other.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        self.assertFalse(self.verify(trusted_public_key=pub)["signatureVerified"])

    def test_old_challenge_replay_fails(self):
        result = self.verify(challenge_nonce="d"*64)
        self.assertTrue(result["signatureVerified"])
        self.assertFalse(result["freshChallengeMatched"])
        self.assertEqual(result["status"], "blocked")

    def test_wrong_witness_fails_challenge(self):
        result = self.verify(witness_id="other")
        self.assertFalse(result["freshChallengeMatched"])

    def test_revision_rollback_under_floor_fails(self):
        self.payload["revision"] = "2"
        result = self.verify(self.make_receipt(), revision=2, minimum_revision=3)
        self.assertFalse(result["headMatched"])

    def test_out_of_order_revision_fails(self):
        self.payload["revision"] = "4"
        self.assertFalse(self.verify(self.make_receipt())["headMatched"])

    def test_conflicting_policy_digest_fails(self):
        self.payload["policySha256"] = "f" * 64
        self.assertFalse(self.verify(self.make_receipt())["headMatched"])

    def test_conflicting_checkpoint_head_fails(self):
        self.payload["checkpointSha256"] = "f" * 64
        self.assertFalse(self.verify(self.make_receipt())["headMatched"])

    def test_cross_boot_replay_fails(self):
        self.payload["bootId"] = "previous-boot"
        self.assertFalse(self.verify(self.make_receipt())["headMatched"])

    def test_malformed_or_unknown_schema_fails(self):
        for body in ({"schema": "ge04-r2p-witness-v2", **{k:v for k,v in self.payload.items() if k!="schema"}},
                     {**self.payload, "authorized": True},
                     {**self.payload, "revision": 3}):
            with self.subTest(body=body):
                self.assertFalse(self.verify(self.make_receipt(body))["signatureVerified"])

    def test_missing_signature_fails(self):
        self.assertFalse(self.verify({"payload":self.payload})["signatureVerified"])

    def test_signature_corruption_fails(self):
        receipt = self.make_receipt()
        receipt["signature"] = "0" * 128
        self.assertFalse(self.verify(receipt)["signatureVerified"])

    def test_invalid_nonce_and_minimum_rejected(self):
        self.assertFalse(self.verify(challenge_nonce="wrong")["signatureVerified"])
        self.assertFalse(self.verify(minimum_revision=0)["signatureVerified"])

    def test_locally_rolled_back_signed_receipt_cannot_prove_external_freshness(self):
        # A locally supplied fresh-looking nonce is NOT proof that an
        # independent online witness serviced the challenge. The API does
        # not and must not claim witnessAuthorityQualified.
        result = self.verify()
        self.assertFalse(result["witnessAuthorityQualified"])
        self.assertEqual(result["status"], "blocked")


if __name__ == "__main__":
    unittest.main()
