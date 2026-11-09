"""Offline public-key enrollment qualification: no keys saved, no host mutations."""
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import unittest

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

source=Path(__file__).resolve().parents[2]/"scripts/ge04-r2s-offline-enrollment.py"
spec=importlib.util.spec_from_file_location("ge04_enrollment_qual",source)
enroll=importlib.util.module_from_spec(spec)
spec.loader.exec_module(enroll)


class EnrollmentTests(unittest.TestCase):
    def setUp(self):
        self.keys={role:Ed25519PrivateKey.generate()
                   for role in ("anchor-operator","security-reviewer")}
        self.pins={role:key.public_key().public_bytes(
            serialization.Encoding.Raw,serialization.PublicFormat.Raw)
            for role,key in self.keys.items()}
        self.claim={
            "schema":enroll.SCHEMA,"serviceId":"ge04-witness-qual",
            "anchorId":"anchor-test","epoch":"epoch-a",
            "anchorSignerPublicKeyHex":"a"*64,
            "witnessSignerSha256":"b"*64,
            "floorRevision":0,"floorHeadSha256":"0"*64,
            "anchorOperatorId":"operator-A",
            "witnessOperatorId":"operator-B",
            "securityReviewId":"reviewer-C",
        }
        self.floor={"anchorId":"anchor-test","epoch":"epoch-a",
                    "revision":0,"headSha256":"0"*64}

    def signed(self,claim=None):
        claim=deepcopy(claim if claim is not None else self.claim)
        return {"claim":claim,"attestations":[
            {"principalId":role,
             "signature":key.sign(enroll.DOMAIN+enroll._canonical(claim)).hex()}
            for role,key in self.keys.items()]}

    def check(self,env=None,**overrides):
        args={"pinned_reviewer_keys":self.pins,
              "expected_anchor_id":"anchor-test",
              "expected_epoch":"epoch-a","minimum_floor":self.floor}
        args.update(overrides)
        return enroll.assess_enrollment(self.signed() if env is None else env,**args)

    def test_valid_signatures_consistent_but_always_block(self):
        r=self.check()
        self.assertTrue(r["enrollmentSignaturesConsistent"])
        self.assertTrue(r["protectedFloorConsistent"])
        self.assertFalse(r["independentAdministrationQualified"])
        self.assertFalse(r["rollbackResistant"])
        self.assertFalse(r["authorizationGranted"])
        self.assertTrue(r["securityHoldActive"])
        self.assertEqual(r["status"],"blocked")

    def test_tampering_including_key_swap_floor_epoch_and_signer_denied(self):
        for update in (
            {"anchorSignerPublicKeyHex":"f"*64},
            {"floorRevision":1,"floorHeadSha256":"f"*64},
            {"epoch":"epoch-b"},
            {"witnessSignerSha256":"f"*64},
            {"serviceId":"different"},
        ):
            with self.subTest(update=update):
                env=self.signed()
                env["claim"].update(update)
                r=self.check(env)
                self.assertFalse(r["enrollmentSignaturesConsistent"])
                self.assertFalse(r["authorizationGranted"])

    def test_mismatched_floor_even_with_valid_signature_denied(self):
        other={**self.floor,"revision":2,"headSha256":"f"*64}
        r=self.check(minimum_floor=other)
        self.assertTrue(r["enrollmentSignaturesConsistent"])
        self.assertFalse(r["protectedFloorConsistent"])

    def test_rollback_floor_rejected(self):
        claim={**self.claim,"floorRevision":2,"floorHeadSha256":"f"*64}
        r=self.check(self.signed(claim))
        self.assertFalse(r["protectedFloorConsistent"])

    def test_wrong_epoch_and_anchor_id_denied(self):
        for args in ({"expected_anchor_id":"other"},{"expected_epoch":"epoch-b"}):
            self.assertFalse(self.check(**args)["enrollmentSignaturesConsistent"])

    def test_missing_duplicate_and_unknown_attesters_denied(self):
        for changed in (
            lambda e:e["attestations"].pop(),
            lambda e:e["attestations"].__setitem__(1,deepcopy(e["attestations"][0])),
            lambda e:e["attestations"][0].update({"principalId":"publisher"}),
            lambda e:e["attestations"][0].update({"signature":"f"*128}),
        ):
            with self.subTest(changed=changed):
                env=self.signed()
                changed(env)
                self.assertFalse(self.check(env)["enrollmentSignaturesConsistent"])

    def test_reused_public_key_denied_even_if_both_roles_signed(self):
        pin={role:self.pins["anchor-operator"] for role in self.pins}
        self.assertFalse(self.check(pinned_reviewer_keys=pin)["enrollmentSignaturesConsistent"])

    def test_boolean_revision_unknown_fields_operator_id_collisions_denied(self):
        for change in (
            {"floorRevision":True},
            {"extra":"value"},
            {"anchorOperatorId":"operator-B"},
            {"securityReviewId":"operator-A"},
            {"anchorSignerPublicKeyHex":"x"*64},
        ):
            with self.subTest(change=change):
                self.assertFalse(self.check(self.signed({**self.claim,**change}))[
                    "enrollmentSignaturesConsistent"])

    def test_duplicate_json_fields_and_nonfinite_denied(self):
        for raw in (
            b'{"x":1,"x":2}',b'{"x":{"a":1,"a":2}}',
            b'{"x":NaN}',b'{"x":Infinity}',b'',
            b'x'*8193,
        ):
            with self.subTest(raw=raw[:10]),self.assertRaises(ValueError):
                enroll.inspect_json_bytes(raw)

    def test_json_round_trip_preserves_exact_signed_claim(self):
        encoded=enroll._canonical(self.signed())
        decoded=enroll.inspect_json_bytes(encoded)
        r=self.check(decoded)
        self.assertTrue(r["enrollmentSignaturesConsistent"])
        self.assertTrue(r["protectedFloorConsistent"])

    def test_different_pinned_reviewer_key_rejected(self):
        replacement=Ed25519PrivateKey.generate().public_key().public_bytes(
            serialization.Encoding.Raw,serialization.PublicFormat.Raw)
        pins={**self.pins,"security-reviewer":replacement}
        self.assertFalse(self.check(pinned_reviewer_keys=pins)[
            "enrollmentSignaturesConsistent"])


if __name__=="__main__":
    unittest.main()
