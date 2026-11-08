"""R2S policy-publication evidence binding: ephemeral keys, no authorization."""
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import unittest

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

ROOT = Path(__file__).resolve().parents[2] / "scripts"

def load(file, alias):
    spec = importlib.util.spec_from_file_location(alias, ROOT / file)
    import sys
    obj = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = obj
    spec.loader.exec_module(obj)
    return obj

pub = load("ge04-r2s-policy-publication-binding.py", "ge04_publication_test")
anchor = load("ge04-r2s-anchor-protocol.py", "ge04_anchor_pub_test")


class PublicationBindingTests(unittest.TestCase):
    def setUp(self):
        self.key = Ed25519PrivateKey.generate()
        self.public = self.key.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        self.policy = {"schema":"alix-policy-qualification-v1",
                       "policyRevision":7,"rules":{"allow":False},
                       "issuerId":"issuer-test"}
        self.previous = "0"*64
        self.head = anchor.make_head(
            anchor_id="anchor-a",epoch="epoch-a",revision=1,
            policy=pub.policy_sha256(self.policy),checkpoint="b"*64,
            signer_key_sha256="c"*64,predecessor=self.previous)
        self.request = {
            "schema":"ge04-r2s-two-role-v1",
            "requestId":"publication-request-0001",
            "anchorId":"anchor-a","epoch":"epoch-a",
            "proposalSha256":anchor.digest(self.head),
            "expectedRevision":0,"expectedHeadSha256":self.previous}
        self.claim = {
            "schema":pub.SCHEMA,
            "publisherPrincipalId":"publisher-A",
            "policyAuthorityId":"alix-governance-publisher",
            "requestId":self.request["requestId"],
            "anchorId":"anchor-a","epoch":"epoch-a",
            "policyRevision":7,"policySha256":pub.policy_sha256(self.policy),
            "checkpointSha256":"b"*64,
            "anchorHeadSha256":anchor.digest(self.head),
            "expectedRevision":0,"expectedHeadSha256":self.previous}

    def envelope(self, claim=None, *, key=None):
        claim=deepcopy(claim if claim is not None else self.claim)
        sig=(key or self.key).sign(pub.DOMAIN+pub.canonical(claim)).hex()
        return pub.canonical({"claim":claim,"signature":sig})

    def check(self, *, policy=None, claim=None, key=None,
              request=None, head=None, envelope=None, **overrides):
        args=dict(policy_bytes=pub.canonical(self.policy if policy is None else policy),
                  envelope_bytes=self.envelope(claim,key=key) if envelope is None else envelope,
                  head=self.head if head is None else head,
                  two_role_request_bytes=pub.canonical(
                      self.request if request is None else request),
                  pinned_authority_key=self.public,
                  expected_authority_id="alix-governance-publisher",
                  expected_publisher_principal="publisher-A",
                  expected_anchor_id="anchor-a",expected_epoch="epoch-a",
                  minimum_revision=0,minimum_head_sha256=self.previous)
        args.update(overrides)
        return pub.assess_publication(**args)

    def test_matching_signed_proposal_never_authorizes(self):
        result=self.check()
        self.assertTrue(result["publicationConsistent"])
        self.assertTrue(result["securityHoldActive"])
        self.assertFalse(result["policyAuthorityQualified"])
        self.assertFalse(result["authorizationGranted"])
        self.assertFalse(result["rollbackResistant"])
        self.assertEqual(result["status"],"blocked")

    def test_policy_mutation_and_policy_revision_mismatch(self):
        policy={**self.policy,"rules":{"allow":True}}
        self.assertFalse(self.check(policy=policy)["publicationConsistent"])
        policy={**self.policy,"policyRevision":8}
        self.assertFalse(self.check(policy=policy)["publicationConsistent"])
        claim={**self.claim,"policyRevision":8}
        self.assertFalse(self.check(claim=claim)["publicationConsistent"])

    def test_signature_wrong_pin_or_signer(self):
        attacker=Ed25519PrivateKey.generate()
        self.assertFalse(self.check(key=attacker)["publicationConsistent"])
        bad_pin=attacker.public_key().public_bytes(
            serialization.Encoding.Raw,serialization.PublicFormat.Raw)
        self.assertFalse(self.check(pinned_authority_key=bad_pin)["publicationConsistent"])

    def test_signed_key_binding_does_not_allow_forged_publisher(self):
        changed={**self.claim,"publisherPrincipalId":"different"}
        self.assertFalse(self.check(claim=changed)["publicationConsistent"])
        self.assertFalse(self.check(expected_publisher_principal="other")["publicationConsistent"])
        changed={**self.claim,"policyAuthorityId":"other"}
        self.assertFalse(self.check(claim=changed)["publicationConsistent"])

    def test_proposal_digest_and_checkpoint_substitution(self):
        changed={**self.request,"proposalSha256":"f"*64}
        self.assertFalse(self.check(request=changed)["publicationConsistent"])
        changed_head={**self.head,"checkpointSha256":"f"*64}
        self.assertFalse(self.check(head=changed_head)["publicationConsistent"])
        changed_claim={**self.claim,"checkpointSha256":"f"*64}
        self.assertFalse(self.check(claim=changed_claim)["publicationConsistent"])

    def test_anchor_epoch_and_predecessor_tampering(self):
        for change in (
            {"epoch":"other"}, {"anchorId":"other"},
            {"expectedRevision":1}, {"expectedHeadSha256":"f"*64},
            {"requestId":"publication-request-0002"}):
            with self.subTest(change=change):
                self.assertFalse(self.check(request={**self.request,**change})[
                    "publicationConsistent"])
        for field,value in (("epoch","wrong"),("anchorId","wrong"),
                            ("previousHeadSha256","f"*64),("revision",2)):
            self.assertFalse(self.check(head={**self.head,field:value})[
                "publicationConsistent"])

    def test_replay_attempt_against_updated_floor_denied(self):
        self.assertFalse(self.check(minimum_revision=1)["publicationConsistent"])
        self.assertFalse(self.check(minimum_head_sha256="f"*64)["publicationConsistent"])

    def test_duplicate_json_keys_nonfinite_oversize_and_bools_denied(self):
        valid=self.envelope()
        for raw in (b'{"claim":{},"claim":{}}',
                    b'{"claim":{"policyRevision":NaN},"signature":"a"}',
                    b"x"*8193,b"",valid[:-1]):
            with self.subTest(raw=raw[:20]):
                self.assertFalse(self.check(envelope=raw)["publicationConsistent"])
        malformed={**self.claim,"policyRevision":True}
        self.assertFalse(self.check(claim=malformed)["publicationConsistent"])
        malformed={**self.claim,"extra":"field"}
        self.assertFalse(self.check(claim=malformed)["publicationConsistent"])
        request={**self.request,"expectedRevision":True}
        self.assertFalse(self.check(request=request)["publicationConsistent"])

    def test_signed_claim_without_real_operator_provenance_still_hold(self):
        self.assertFalse(self.check()["policyAuthorityQualified"])
        # No ALiX governance integration or independent key provenance exists.
        self.assertNotIn("workerAllowed",self.check())

    def test_changed_raw_request_encoding_rejected_if_fields_disagree(self):
        req={**self.request,"expectedHeadSha256":"f"*64}
        self.assertFalse(self.check(request=req)["publicationConsistent"])

    def test_policy_duplicate_field_rejected_before_signature(self):
        raw=b'{"policyRevision":7,"policyRevision":7}'
        self.assertFalse(self.check(policy_bytes=raw)["publicationConsistent"])

if __name__ == "__main__":
    unittest.main()
