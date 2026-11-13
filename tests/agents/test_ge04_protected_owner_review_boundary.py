"""GE-04 protected transaction boundary refuses caller-asserted authority."""
import hashlib
from pathlib import Path
import sys
import unittest
from types import MappingProxyType

SRC = Path(__file__).resolve().parents[2] / "native/ge04"
sys.path.insert(0, str(SRC))
from protected_owner_review_boundary import (
    GATES, ProtectedOwnerBoundary, evaluate_protected_owner_review,
)
from prebirth_issuance_contract import canonical_prebirth
from test_ge04_prebirth_issuance_contract import prebirth
from bootstrap_binding import UNIT


def assertions(claim=True, selected=None):
    return {"schemaVersion": 1, "unit": UNIT,
            "prebirthSha256": hashlib.sha256(canonical_prebirth(prebirth())).hexdigest(),
            "requestedGate": selected or GATES[-1],
            "claims": {name: claim for name in GATES}}


class ProtectedOwnerBoundaryTests(unittest.TestCase):
    def test_all_claims_true_still_no_security_clearance(self):
        record = evaluate_protected_owner_review(prebirth(), assertions())
        self.assertEqual(record["status"], "SECURITY_HOLD_PROTECTED_ORIGIN_UNAVAILABLE")
        self.assertEqual(record["unverified"], GATES)
        self.assertEqual(record["required"], GATES)
        with self.assertRaises(TypeError):
            record["status"] = "AUTHORIZED"

    def test_any_requested_gate_including_early_one_stays_unverified(self):
        for stage in GATES:
            with self.subTest(stage=stage):
                result = evaluate_protected_owner_review(
                    prebirth(), assertions(claim=False, selected=stage))
                self.assertEqual(result["status"],
                                 "SECURITY_HOLD_PROTECTED_ORIGIN_UNAVAILABLE")
                self.assertEqual(result["required"],
                                 GATES[:GATES.index(stage) + 1])

    def test_malformed_claims_and_substitutions_refuse(self):
        original = assertions()
        invalid = (
            {"unit": "other.service"},
            {"prebirthSha256": "f"*64},
            {"requestedGate": "ACK_AUTHORIZED"},
            {"schemaVersion": True},
            {"claims": {**original["claims"], "SOURCE_REVIEWED": 1}},
            {"claims": {**original["claims"], "unlisted": True}},
        )
        for change in invalid:
            with self.subTest(change=change), self.assertRaises(ValueError):
                evaluate_protected_owner_review(prebirth(), {**original, **change})
        with self.assertRaises(ValueError):
            evaluate_protected_owner_review(prebirth(), {
                key: value for key, value in original.items() if key != "claims"})

    def test_one_shot_review_replay_quarantines(self):
        boundary = ProtectedOwnerBoundary()
        result = boundary.inspect(prebirth(), MappingProxyType(assertions()))
        self.assertEqual(result["status"], "SECURITY_HOLD_PROTECTED_ORIGIN_UNAVAILABLE")
        with self.assertRaises(ValueError):
            boundary.inspect(prebirth(), assertions())
        self.assertEqual(boundary.status, "SECURITY_HOLD_QUARANTINED")

    def test_failed_packet_poisoned(self):
        boundary = ProtectedOwnerBoundary()
        with self.assertRaises(ValueError):
            boundary.inspect(prebirth(), {**assertions(), "unit": "other"})
        self.assertEqual(boundary.status, "SECURITY_HOLD_QUARANTINED")
        with self.assertRaises(ValueError):
            boundary.inspect(prebirth(), assertions())

    def test_every_privileged_method_denied_without_dependencies(self):
        for method in ("publish_original", "create_unit", "issue_ack",
                       "recover", "admit_worker"):
            boundary = ProtectedOwnerBoundary()
            with self.subTest(method=method), self.assertRaises(PermissionError):
                getattr(boundary, method)()
            self.assertEqual(boundary.status, "SECURITY_HOLD_QUARANTINED")
            with self.assertRaises(ValueError):
                boundary.inspect(prebirth(), assertions())
