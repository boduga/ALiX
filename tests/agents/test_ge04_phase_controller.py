"""GE-04 read-only phase controller: no trusted ACK or privileged process."""
from pathlib import Path
import sys
import time
import unittest
from types import MappingProxyType

SRC = Path(__file__).resolve().parents[2] / "native/ge04"
sys.path.insert(0, str(SRC))
from phase_controller import ReadOnlyPhaseController, decode_native_event, PHASES
from bootstrap_binding import UNIT


def original():
    return dict(schemaVersion=1, unit=UNIT, invocation="a" * 32,
                attempt=1, keeperPid=101, keeperTicks=4567,
                mountId=39, mountDevice="0:29", mountRoot="/",
                ancestry=((1, 2), (1, 3), (1, 4)), nonce="b" * 64,
                sourceSha256="c" * 64, controllerSha256="d" * 64)


def event(phase, a=0, at=0, b=0, bt=0):
    return f"EV {phase} {a} {at} {b} {bt}\n".encode()


def witness(_original):
    return MappingProxyType(dict(
        status="UNQUALIFIED_MANAGER_KERNEL_CORRELATION", managerOwner=":1.5",
        kernel=MappingProxyType(dict(
            status="UNQUALIFIED_KERNEL_UNIT_CORRELATION", pid=101,
            startticks=4567))))


class PhaseControllerTests(unittest.TestCase):
    def test_six_phases_ordered_with_no_ack_authority(self):
        ctrl = ReadOnlyPhaseController(original(), observer=witness)
        for phase in PHASES:
            self.assertEqual(ctrl.accept(event(phase), time.monotonic() + 2),
                             "UNQUALIFIED_PHASE_OBSERVATION")
            with self.assertRaises(PermissionError):
                ctrl.issue_ack(phase)
        self.assertEqual(tuple(item["phase"] for item in ctrl.evidence), PHASES)
        self.assertEqual(len(ctrl.evidence), 6)
        self.assertEqual(ctrl.accept(event("EMPTY"), time.monotonic() + 2),
                         "QUARANTINE_PENDING_INDEPENDENT_RECOVERY")
        with self.assertRaises(ValueError):
            ctrl.accept(event("EMPTY"), time.monotonic() + 2)

    def test_denied_always_quarantines_and_never_observes(self):
        def reject(_):
            raise AssertionError("DENIED should quarantine without observing")
        ctrl = ReadOnlyPhaseController(original(), observer=reject)
        self.assertEqual(ctrl.accept(event("DENIED"), time.monotonic() + 1),
                         "QUARANTINE_PENDING_INDEPENDENT_RECOVERY")
        self.assertEqual(len(ctrl.evidence), 1)
        with self.assertRaises(PermissionError):
            ctrl.issue_ack("DENIED")

    def test_wrong_phase_replay_and_missing_original_poison(self):
        for raw in (event("READY"), event("PRE_JOIN"), event("EMPTY"),
                    event("INTENT", 42, 0), event("INTENT", 42, 7, 42, 8),
                    event("INTENT").replace(b"\n", b"\r\n"),
                    b"EV INTENT 0 0 0 0\nEXTRA", b"c"):
            ctrl = ReadOnlyPhaseController(original(), observer=witness)
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                ctrl.accept(raw, time.monotonic() + 2)
            self.assertEqual(ctrl.status,
                             "QUARANTINE_PENDING_INDEPENDENT_RECOVERY")
            with self.assertRaises(ValueError):
                ctrl.accept(event("INTENT"), time.monotonic() + 2)
        with self.assertRaises(ValueError):
            ReadOnlyPhaseController({**original(), "unit": "other.service"})
        with self.assertRaises(ValueError):
            ReadOnlyPhaseController({**original(), "attempt": 0})

    def test_missing_or_forged_manager_kernel_witness_poison(self):
        wrong = (
            lambda _: None,
            lambda _: {},
            lambda _: {"status": "UNQUALIFIED_MANAGER_KERNEL_CORRELATION",
                       "managerOwner": ":1.5"},
            lambda _: {"status": "UNQUALIFIED_MANAGER_KERNEL_CORRELATION",
                       "managerOwner": ":1.5", "kernel": {
                           "status": "UNQUALIFIED_KERNEL_UNIT_CORRELATION",
                           "pid": 102, "startticks": 4567}},
            lambda _: (_ for _ in ()).throw(ValueError("NoSuchUnit")),
        )
        for callback in wrong:
            ctrl = ReadOnlyPhaseController(original(), observer=callback)
            with self.subTest(callback=callback), self.assertRaises(
                    (ValueError, TypeError)):
                ctrl.accept(event("INTENT"), time.monotonic() + 1)
            self.assertEqual(ctrl.status,
                             "QUARANTINE_PENDING_INDEPENDENT_RECOVERY")

    def test_expired_deadline_and_exhausted_entry(self):
        ctrl = ReadOnlyPhaseController(original(), observer=witness)
        with self.assertRaises(ValueError):
            ctrl.accept(event("INTENT"), time.monotonic() - 0.001)
        self.assertEqual(ctrl.status,
                         "QUARANTINE_PENDING_INDEPENDENT_RECOVERY")
        with self.assertRaises(ValueError):
            ReadOnlyPhaseController(original(), observer=witness,
                                    maximum_events=100)

    def test_native_parser_boundaries(self):
        self.assertEqual(decode_native_event(event("PINNED", 12, 55)),
                         ("PINNED", (12, 55, 0, 0)))
        for bad in (event("READY", 0, 1), event("READY", 2**31, 2),
                    event("READY", 1, 2**64),
                    event("READY", 11, 3, 11, 4),
                    event("READY").replace(b"EV ", b"X ", 1),
                    event("INTENT") * 2, b"x" * 145):
            with self.subTest(raw=bad), self.assertRaises(ValueError):
                decode_native_event(bad)
