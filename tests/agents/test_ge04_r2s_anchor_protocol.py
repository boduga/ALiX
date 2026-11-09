"""Adversarial qualification-only anchor protocol tests. No infrastructure writes."""
import importlib.util
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import unittest

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/ge04-r2s-anchor-protocol.py"
spec = importlib.util.spec_from_file_location("ge04_r2s_anchor", SCRIPT)
anchor = importlib.util.module_from_spec(spec)
import sys
sys.modules[spec.name] = anchor
spec.loader.exec_module(anchor)


class AnchorProtocolTests(unittest.TestCase):
    def setUp(self):
        self.key = Ed25519PrivateKey.generate()
        self.public = self.key.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        self.signer_digest = "c"*64
        self.policy = "a"*64
        self.checkpoint = "b"*64
        self.anchor_id = "isolated-anchor"
        self.epoch = "epoch-1"

    def head(self, revision=1, predecessor=None, *, policy=None, epoch=None, key_id=None):
        if predecessor is None:
            predecessor = anchor.GENESIS
        return anchor.make_head(
            anchor_id=self.anchor_id, epoch=epoch or self.epoch,
            revision=revision, policy=policy or self.policy,
            checkpoint=self.checkpoint, signer_key_sha256=key_id or self.signer_digest,
            predecessor=predecessor)

    def envelope(self, head, signing_key=None):
        return {"head": head, "signature": (signing_key or self.key).sign(
            anchor.DOMAIN + anchor.canonical(head)).hex()}

    def assess(self, heads, *, floor=None, public=None, epoch=None):
        return anchor.assess_chain(
            [self.envelope(h) for h in heads],
            anchor_public_key=public if public is not None else self.public,
            anchor_id=self.anchor_id, epoch=epoch or self.epoch,
            trusted_floor=floor or {"revision":0,"headSha256":anchor.GENESIS})

    def test_signed_genesis_still_cannot_authorize(self):
        result = self.assess([self.head()])
        self.assertTrue(result["historyConsistent"])
        self.assertEqual(result["status"], "blocked")
        self.assertFalse(result["rollbackResistant"])
        self.assertFalse(result["authorizationGranted"])
        self.assertTrue(result["securityHoldActive"])

    def test_two_consecutive_signed_checkpoints(self):
        first = self.head()
        second = self.head(2, anchor.digest(first))
        self.assertTrue(self.assess([first, second])["historyConsistent"])
        floor = {"revision":1,"headSha256":anchor.digest(first)}
        self.assertTrue(self.assess([second],floor=floor)["historyConsistent"])

    def test_rollbacks_gaps_duplicates_and_replay_fail(self):
        first = self.head()
        second = self.head(2, anchor.digest(first))
        valid_floor = {"revision":1,"headSha256":anchor.digest(first)}
        for heads, floor in [
            ([first], valid_floor),
            ([first, first], None),
            ([self.head(3, anchor.digest(first))], valid_floor),
            ([second, second], valid_floor),
            ([second], {"revision":1, "headSha256":"d"*64}),
        ]:
            with self.subTest(heads=heads, floor=floor):
                self.assertFalse(self.assess(heads, floor=floor)["historyConsistent"])

    def test_signed_fork_at_equal_revision_is_detected_against_trusted_floor(self):
        first = self.head()
        forged_second = self.head(2, anchor.digest(first),policy="f"*64)
        floor = {"revision":2, "headSha256":anchor.digest(self.head(2, anchor.digest(first)))}
        self.assertFalse(self.assess([forged_second],floor=floor)["historyConsistent"])

    def test_forked_second_head_with_same_revision_rejected(self):
        first = self.head()
        legitimate_second = self.head(2,anchor.digest(first))
        divergent_second = self.head(2,anchor.digest(first),policy="f"*64)
        legitimate_digest = anchor.digest(legitimate_second)
        self.assertNotEqual(legitimate_digest,anchor.digest(divergent_second))
        # Two conflicting published views are distinguishable by digest;
        # without a separately trusted checkpoint monitor this cannot prove
        # which branch (if either) was committed.
        floor = {"revision":2,"headSha256":legitimate_digest}
        self.assertFalse(self.assess([divergent_second],floor=floor)["historyConsistent"])
        self.assertTrue(self.assess([legitimate_second],floor={
            "revision":1,"headSha256":anchor.digest(first)})["historyConsistent"])

    def test_key_substitution_and_bad_signature_fail(self):
        first = self.head()
        attacker = Ed25519PrivateKey.generate()
        result = anchor.assess_chain(
            [self.envelope(first,signing_key=attacker)],anchor_public_key=self.public,
            anchor_id=self.anchor_id,epoch=self.epoch,
            trusted_floor={"revision":0,"headSha256":anchor.GENESIS})
        self.assertFalse(result["historyConsistent"])
        wrong_public = attacker.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        self.assertFalse(self.assess([first],public=wrong_public)["historyConsistent"])

    def test_changed_epoch_rejected(self):
        self.assertFalse(self.assess([self.head(epoch="epoch-2")])["historyConsistent"])

    def test_malformed_fields_and_bool_revision_rejected(self):
        original = self.head()
        for changed in [{"revision":True},{"revision":-1},{"policySha256":"ABCD"},
                        {"signerKeySha256":"f"*63},{"extra":"x"},
                        {"previousHeadSha256":"f"*64}]:
            with self.subTest(changed=changed):
                invalid = {**original, **changed}
                with self.assertRaises(ValueError):
                    anchor.validate_head(invalid)
        self.assertFalse(self.assess([])["historyConsistent"])

    def test_untrusted_floor_and_missing_history_denied(self):
        for floor in ({"revision":True,"headSha256":anchor.GENESIS},
                      {"revision":0,"headSha256":"f"*64},
                      {"revision":0},
                      {"revision":2,"headSha256":"nothex"}):
            self.assertFalse(self.assess([self.head()],floor=floor)["historyConsistent"])

    def test_commit_requires_separate_role_and_publisher(self):
        store=anchor.QualificationCompareStore()
        proposal=anchor.Proposal(0,anchor.GENESIS,self.head(),"publisher-A")
        for role,publishers in [
            ("verifier",frozenset({"publisher-A"})),
            ("publisher",frozenset({"publisher-A"})),
            ("security-operator",frozenset({"publisher-A"})),
            ("committer",frozenset({"publisher-B"}))]:
            out=store.propose_and_commit(proposal,asserted_role=role,publisher_allowlist=publishers)
            self.assertEqual(out["status"],"blocked")
            self.assertIsNone(store.snapshot())

    def test_concurrent_compare_and_advance_single_winner(self):
        store=anchor.QualificationCompareStore()
        proposal=anchor.Proposal(0,anchor.GENESIS,self.head(),"publisher-A")
        def commit(_):
            return store.propose_and_commit(proposal,asserted_role="committer",
                                            publisher_allowlist=frozenset({"publisher-A"}))
        with ThreadPoolExecutor(max_workers=16) as pool:
            results=list(pool.map(commit,range(64)))
        self.assertEqual(sum(x["status"]=="recorded-qualification-only" for x in results),1)
        self.assertEqual(store.snapshot()["revision"],1)
        self.assertTrue(all(x["authorizationGranted"] is False for x in results))

    def test_unknown_commit_outcome_reconcile_not_reapply(self):
        store=anchor.QualificationCompareStore()
        first=self.head()
        proposal=anchor.Proposal(0,anchor.GENESIS,first,"publisher-A")
        result=store.propose_and_commit(proposal,asserted_role="committer",
                                        publisher_allowlist=frozenset({"publisher-A"}),
                                        simulate_unknown_outcome=True)
        self.assertEqual(result["status"],"blocked")
        self.assertEqual(store.snapshot()["revision"],1)
        again=store.propose_and_commit(proposal,asserted_role="committer",
                                       publisher_allowlist=frozenset({"publisher-A"}))
        self.assertEqual(again["status"],"blocked")

    def test_epoch_rotation_and_same_revision_fork_denied(self):
        first=self.head()
        store=anchor.QualificationCompareStore(first)
        for proposed in (
            self.head(2,anchor.digest(first),epoch="epoch-2"),
            self.head(2,anchor.digest(first),key_id="f"*64),
            self.head(1,anchor.GENESIS,policy="f"*64),
            self.head(3,anchor.digest(first))):
            out=store.propose_and_commit(
                anchor.Proposal(1,anchor.digest(first),proposed,"publisher-A"),
                asserted_role="committer",publisher_allowlist=frozenset({"publisher-A"}))
            self.assertEqual(out["status"],"blocked")
        self.assertEqual(store.snapshot(),first)

if __name__=="__main__":
    unittest.main()
