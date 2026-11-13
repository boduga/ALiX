"""GE-04 JobRemoved diagnostic window, unprivileged, synthetic events."""
from pathlib import Path
import sys
import unittest
from types import MappingProxyType

SRC = Path(__file__).resolve().parents[2] / "native/ge04"
sys.path.insert(0, str(SRC))
from systemd_job_event_contract import JobEventWindow, job_removed_diagnostic
from bootstrap_binding import UNIT


def expected():
    return {"managerOwner": ":1.5",
            "jobPath": "/org/freedesktop/systemd1/job/42",
            "unit": UNIT}


def signal():
    return {"sender": ":1.5", "jobId": 42,
            "jobPath": "/org/freedesktop/systemd1/job/42",
            "unit": UNIT, "result": "done"}


class JobEventContractTests(unittest.TestCase):
    def test_one_event_matches_and_never_authorizes(self):
        window = JobEventWindow(MappingProxyType(expected()))
        result = window.accept(MappingProxyType(signal()))
        self.assertEqual(result["status"],
                         "UNQUALIFIED_SYSTEMD_JOB_EVENT_CORRELATION")
        self.assertEqual(window.status, "UNQUALIFIED_JOB_CORRELATED")
        with self.assertRaises(PermissionError):
            window.issue_ack()
        with self.assertRaises(TypeError):
            result["result"] = "other"

    def test_same_event_replayed_poisoned(self):
        window = JobEventWindow(expected())
        window.accept(signal())
        with self.assertRaises(ValueError):
            window.accept(signal())
        self.assertEqual(window.status, "UNQUALIFIED_QUARANTINED")
        with self.assertRaises(ValueError):
            window.accept(signal())

    def test_wrong_sender_job_path_job_id_unit_result_or_extra(self):
        modifications = (
            {"sender": ":1.6"},
            {"jobPath": "/org/freedesktop/systemd1/job/43"},
            {"jobId": 43},
            {"jobId": True},
            {"jobPath": "/org/freedesktop/systemd1/job/042"},
            {"jobPath": "/org/freedesktop/systemd1/job/0"},
            {"unit": "other.service"},
            {"result": "failed"},
            {"result": "skipped"},
            {"extra": 2},
        )
        for change in modifications:
            window = JobEventWindow(expected())
            with self.subTest(change=change), self.assertRaises(ValueError):
                window.accept({**signal(), **change})
            self.assertEqual(window.status, "UNQUALIFIED_QUARANTINED")

    def test_cannot_reconstruct_original_job_after_missing_event(self):
        for changed in (
            {"jobPath": "/org/freedesktop/systemd1/job/0"},
            {"managerOwner": "org.freedesktop.systemd1"},
            {"unit": "other.service"},
            {"extra": "unknown"},
        ):
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                JobEventWindow({**expected(), **changed})
        window = JobEventWindow(expected())
        window.quarantine()
        with self.assertRaises(ValueError):
            window.accept(signal())

    def test_canonical_but_forged_event_does_not_grant_authority(self):
        window = JobEventWindow(expected())
        result = window.accept(signal())
        self.assertTrue(result["status"].startswith("UNQUALIFIED"))
        with self.assertRaises(PermissionError):
            window.issue_ack()
