"""GE-04 pure prebirth sequencing tests; never create systemd units or root files."""
from pathlib import Path
import sys
import unittest

SRC = Path(__file__).resolve().parents[2] / "native/ge04"
sys.path.insert(0, str(SRC))
from prebirth_issuance_contract import (
    PrebirthIssuanceContract, canonical_birth, canonical_prebirth,
)
from bootstrap_binding import UNIT


def prebirth():
    return {
        "schemaVersion": 1, "unit": UNIT,
        "bootId": "a" * 32, "attempt": 4, "nonce": "b" * 64,
        "sourceSha256": "c" * 64, "controllerSha256": "d" * 64,
        "expectedAbsent": True,
    }


def birth():
    return {
        "unit": UNIT, "bootId": "a" * 32, "attempt": 4,
        "nonce": "b" * 64, "invocation": "e" * 32,
        "keeperPid": 10001, "keeperTicks": 23456,
        "mountId": 32, "mountDevice": "0:28", "mountRoot": "/",
        "ancestry": [[1, 2], [1, 3], [1, 4]], "restartCount": 0,
    }


class PrebirthIssuanceTests(unittest.TestCase):
    def prepare(self, **changes):
        return PrebirthIssuanceContract(
            prebirth(), unit_absent_before_creation=True,
            original_durable=True, **changes)

    def test_prebirth_then_born_is_diagnostic_never_authority(self):
        contract = self.prepare()
        self.assertEqual(contract.status, "UNQUALIFIED_PREBIRTH")
        observation = contract.observe_birth(birth())
        self.assertEqual(contract.status, "UNQUALIFIED_BIRTH_OBSERVED")
        self.assertEqual(observation["status"], "UNQUALIFIED_BIRTH_OBSERVED")
        self.assertEqual(observation["record"]["sourceSha256"], "c"*64)
        self.assertEqual(observation["record"]["invocation"], "e"*32)
        with self.assertRaises(TypeError):
            observation["record"]["nonce"] = "a"*64
        for method in (contract.issue_approval, contract.issue_ack, contract.recover):
            with self.assertRaises(PermissionError):
                method()
        self.assertEqual(contract.status, "UNQUALIFIED_QUARANTINED")
        with self.assertRaises(ValueError):
            contract.observe_birth(birth())

    def test_absent_or_non_durable_original_never_prepared(self):
        with self.assertRaises(ValueError):
            PrebirthIssuanceContract(prebirth())
        with self.assertRaises(ValueError):
            PrebirthIssuanceContract(prebirth(), unit_absent_before_creation=True)
        with self.assertRaises(ValueError):
            PrebirthIssuanceContract(prebirth(), original_durable=True)
        with self.assertRaises(ValueError):
            PrebirthIssuanceContract(prebirth(), unit_absent_before_creation=1,
                                     original_durable=True)

    def test_prebirth_missing_extra_and_forged_keys_rejected(self):
        sample = prebirth()
        for changed in (
            {"expectedAbsent": False}, {"attempt": 0}, {"attempt": True},
            {"bootId": "A"*32}, {"nonce": "B"*64},
            {"sourceSha256": "z"*64}, {"unit": "other.service"},
            {"extra": "ignored"}, {"schemaVersion": 2},
        ):
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                canonical_prebirth({**sample, **changed})
        with self.assertRaises(ValueError):
            canonical_prebirth({k: v for k, v in sample.items() if k != "bootId"})

    def test_restart_generation_attempt_and_cgroup_mismatch_quarantined(self):
        original = birth()
        for changed in (
            {"bootId": "f"*32}, {"nonce": "f"*64}, {"attempt": 5},
            {"restartCount": 1}, {"restartCount": True},
            {"invocation": "z"*32}, {"keeperPid": 0},
            {"mountRoot": "/sub"}, {"mountDevice": "other"},
            {"ancestry": [[1, 2], [1, 3], [0, 4]]},
            {"unit": "other.service"}, {"unknown": 1},
        ):
            contract = self.prepare()
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                contract.observe_birth({**original, **changed})
            self.assertEqual(contract.status, "UNQUALIFIED_QUARANTINED")
            with self.assertRaises(ValueError):
                contract.observe_birth(original)

    def test_crash_or_ambiguity_quarantines_irrevocably(self):
        contract = self.prepare()
        self.assertEqual(contract.quarantine("CRASH_AFTER_UNIT_CREATE"),
                         "UNQUALIFIED_QUARANTINED")
        self.assertEqual(contract.reason, "CRASH_AFTER_UNIT_CREATE")
        with self.assertRaises(ValueError):
            contract.observe_birth(birth())
        with self.assertRaises(PermissionError):
            contract.recover()

    def test_birth_replay_rejected_and_quarantined(self):
        contract = self.prepare()
        contract.observe_birth(birth())
        with self.assertRaises(ValueError):
            contract.observe_birth(birth())
        self.assertEqual(contract.status, "UNQUALIFIED_QUARANTINED")
        self.assertEqual(contract.reason, "REPLAY_OR_UNEXPECTED_BIRTH")
        for changed in ({**birth(), "restartCount": 1}, birth()):
            with self.assertRaises(ValueError):
                contract.observe_birth(changed)
        self.assertEqual(contract.status, "UNQUALIFIED_QUARANTINED")

    def test_fully_canonical_looking_claim_still_unqualified(self):
        # Any caller can invent all these claims and even assert that the
        # original was durable: no root custody or service birth is proved.
        contract = self.prepare()
        evidence = contract.observe_birth(birth())
        self.assertTrue(evidence["status"].startswith("UNQUALIFIED"))
        with self.assertRaises(PermissionError):
            contract.issue_approval()
