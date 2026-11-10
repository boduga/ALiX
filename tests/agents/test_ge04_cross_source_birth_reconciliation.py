"""GE-04 cross-source birth packet (synthetic, no privileged authority)."""
from pathlib import Path
import sys
import unittest
from types import MappingProxyType

SRC = Path(__file__).resolve().parents[2] / "native/ge04"
sys.path.insert(0, str(SRC))
from bootstrap_binding import UNIT
from cross_source_birth_reconciliation import (
    OneShotBirthPacket, reconcile_birth_packet,
)
from test_ge04_exclusive_birth_handoff import evidence, claim, complete, born
from test_ge04_prebirth_issuance_contract import birth


def packet():
    intent, journal, absence = evidence()
    current_birth = birth()
    current_birth["invocation"] = "f" * 32
    current_birth["keeperPid"] = 123
    orig = {
        "schemaVersion": 1, "unit": UNIT, "invocation": "f"*32,
        "keeperPid": 123, "keeperTicks": 23456,
        "mountId": 32, "mountDevice": "0:28", "mountRoot": "/",
        "ancestry": ((1, 2), (1, 3), (1, 4)),
        "attempt": intent["attempt"], "nonce": intent["nonce"],
        "sourceSha256": intent["sourceSha256"],
        "controllerSha256": intent["controllerSha256"],
    }
    return {
        "prebirth": intent, "journal": journal, "absence": absence,
        "creation": claim(),
        "job_event": {
            "sender": ":1.5", "jobId": 42,
            "jobPath": "/org/freedesktop/systemd1/job/42",
            "unit": UNIT, "result": "done",
        }, "live_signal": {
            "status": "UNQUALIFIED_LIVE_SYSTEMD_JOB_SIGNAL",
            "managerOwner": ":1.5",
            "jobPath": "/org/freedesktop/systemd1/job/42",
            "unit": UNIT, "result": "done",
        }, "completion": complete(), "manager": born(),
        "original": orig,
        "kernel": {
            "status": "UNQUALIFIED_KERNEL_UNIT_CORRELATION",
            "pid": 123, "startticks": 23456,
            "mount": (32, "0:28"), "cgroup": "/system.slice/" + UNIT,
        }, "birth_claim": current_birth,
    }


class CrossSourcePacketTests(unittest.TestCase):
    def test_consistent_packet_still_unqualified(self):
        instance = OneShotBirthPacket()
        result = instance.accept(**packet())
        self.assertEqual(result["status"],
                         "UNQUALIFIED_CROSS_SOURCE_BIRTH_CORRELATION")
        self.assertEqual(instance.status, "UNQUALIFIED_PACKET_CORRELATED")
        self.assertEqual(result["keeperTicks"], 23456)
        with self.assertRaises(TypeError):
            result["status"] = "AUTHORIZED"
        for method in (instance.issue_ack, instance.create_unit):
            with self.assertRaises(PermissionError):
                method()

    def test_no_replay_even_with_identical_packet(self):
        instance = OneShotBirthPacket()
        instance.accept(**packet())
        with self.assertRaises(ValueError):
            instance.accept(**packet())
        self.assertEqual(instance.status, "UNQUALIFIED_QUARANTINED")
        with self.assertRaises(ValueError):
            instance.accept(**packet())

    def test_original_keeper_and_mount_mismatch_quarantines(self):
        for wrong in (
            {"keeperPid": 124}, {"keeperTicks": 23457},
            {"mountId": 33}, {"mountDevice": "0:29"},
            {"nonce": "a"*64}, {"attempt": 5},
            {"sourceSha256": "a"*64}, {"invocation": "a"*32},
            {"ancestry": ((1, 2), (1, 3), (1, 9))},
        ):
            case = packet()
            case["original"] = {**case["original"], **wrong}
            instance = OneShotBirthPacket()
            with self.subTest(wrong=wrong), self.assertRaises(ValueError):
                instance.accept(**case)
            self.assertEqual(instance.status, "UNQUALIFIED_QUARANTINED")

    def test_independent_kernel_claim_mismatch_quarantines(self):
        for wrong in (
            {"pid": 124}, {"startticks": 23457},
            {"mount": (33, "0:28")}, {"mount": (32, "0:29")},
            {"cgroup": "/system.slice/other.service"},
            {"status": "UNQUALIFIED_FAKE"},
            {"extra": 1},
        ):
            case = packet()
            case["kernel"] = {**case["kernel"], **wrong}
            instance = OneShotBirthPacket()
            with self.subTest(wrong=wrong), self.assertRaises(ValueError):
                instance.accept(**case)
            self.assertEqual(instance.status, "UNQUALIFIED_QUARANTINED")

    def test_job_forgery_and_wrong_event_quarantine(self):
        for wrong in (
            {"jobId": 43}, {"sender": ":1.6"},
            {"result": "failed"}, {"jobPath": "/org/freedesktop/systemd1/job/43"},
            {"unit": "other.service"},
        ):
            case = packet()
            case["job_event"] = {**case["job_event"], **wrong}
            with self.subTest(wrong=wrong), self.assertRaises(ValueError):
                OneShotBirthPacket().accept(**case)

    def test_manager_and_birth_fence(self):
        for wrong in (
            {"managerOwner": ":1.6"}, {"keeperPid": 124},
            {"invocation": "a"*32},
        ):
            case = packet()
            if "managerOwner" in wrong:
                case["absence"] = {**case["absence"], **wrong}
            else:
                case["birth_claim"] = {**case["birth_claim"], **wrong}
            with self.subTest(wrong=wrong), self.assertRaises(ValueError):
                OneShotBirthPacket().accept(**case)

    def test_bounded_live_signal_disagreement_is_quarantined(self):
        for wrong in ({"managerOwner": ":1.6"}, {"result": "failed"},
                      {"jobPath": "/org/freedesktop/systemd1/job/43"},
                      {"status": "AUTHORIZED"}, {"extra": "x"}):
            case = packet()
            case["live_signal"] = {**case["live_signal"], **wrong}
            instance = OneShotBirthPacket()
            with self.subTest(wrong=wrong), self.assertRaises(ValueError):
                instance.accept(**case)
            self.assertEqual(instance.status, "UNQUALIFIED_QUARANTINED")

    def test_kernel_consistency_cannot_replace_prebirth_receipt(self):
        case = packet()
        case["journal"] = {**case["journal"], "recordBytes": b"{}\n"}
        with self.assertRaises(ValueError):
            OneShotBirthPacket().accept(**case)

    def test_immutable_read_only_sources_still_unqualified(self):
        case = packet()
        case["absence"] = MappingProxyType(case["absence"])
        case["manager"] = MappingProxyType({
            **case["manager"], "properties":
                MappingProxyType(case["manager"]["properties"]),
        })
        case["kernel"] = MappingProxyType(case["kernel"])
        case["live_signal"] = MappingProxyType(case["live_signal"])
        self.assertEqual(reconcile_birth_packet(**case)["status"],
                         "UNQUALIFIED_CROSS_SOURCE_BIRTH_CORRELATION")

    def test_crash_has_no_recovery_or_ack(self):
        instance = OneShotBirthPacket()
        with self.assertRaises(PermissionError):
            instance.recover()
        self.assertEqual(instance.status, "UNQUALIFIED_QUARANTINED")
        with self.assertRaises(ValueError):
            instance.accept(**packet())
        with self.assertRaises(PermissionError):
            instance.issue_ack()

    def test_absent_kernel_or_manager_never_yields_witness(self):
        for field in ("kernel", "manager", "job_event", "live_signal", "original", "birth_claim"):
            case = packet()
            case[field] = None
            instance = OneShotBirthPacket()
            with self.subTest(field=field), self.assertRaises(
                    (TypeError, ValueError, KeyError, AttributeError)):
                instance.accept(**case)
            self.assertEqual(instance.status, "UNQUALIFIED_QUARANTINED")
