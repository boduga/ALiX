"""GE-04 exclusive birth handoff: caller evidence remains NON-authorizing."""
from pathlib import Path
import hashlib
import sys
import unittest
from types import MappingProxyType

SRC = Path(__file__).resolve().parents[2] / "native/ge04"
sys.path.insert(0, str(SRC))
from exclusive_birth_handoff import ExclusiveUnitBirthHandoff
from prebirth_issuance_contract import canonical_prebirth
from test_ge04_prebirth_issuance_contract import prebirth
from bootstrap_binding import UNIT

PATH = ("/org/freedesktop/systemd1/unit/"
        "ge04_2dr1b2_2dview_2dqualification_2eservice")


def evidence():
    intent = prebirth()
    raw = canonical_prebirth(intent)
    return intent, {"status": "UNQUALIFIED_FIXTURE_PREBIRTH_PERSISTED",
                    "recordBytes": raw}, {
        "status": "UNQUALIFIED_SYSTEMD_ABSENCE_OBSERVATION",
        "unit": UNIT, "managerOwner": ":1.5"}


def claim():
    intent, journal, _ = evidence()
    return {"unit": UNIT, "method": "StartTransientUnit", "mode": "fail",
            "managerOwner": ":1.5", "jobPath": "/org/freedesktop/systemd1/job/42",
            "attempt": intent["attempt"], "nonce": intent["nonce"],
            "prebirthSha256": hashlib.sha256(journal["recordBytes"]).hexdigest()}


def complete():
    return {"unit": UNIT, "managerOwner": ":1.5",
            "jobPath": "/org/freedesktop/systemd1/job/42", "result": "done",
            "prebirthSha256": claim()["prebirthSha256"]}


def born():
    return {
        "status": "UNQUALIFIED_SYSTEMD_MANAGER_OBSERVATION",
        "owner": ":1.5",
        "properties": {
            "unit": UNIT, "invocation": "f"*32, "mainPid": 123,
            "controlGroup": "/system.slice/" + UNIT,
            "activeState": "active", "subState": "running",
            "restartCount": 0, "objectPath": PATH,
        },
    }


class ExclusiveHandoffTests(unittest.TestCase):
    def new(self):
        return ExclusiveUnitBirthHandoff(*evidence())

    def test_ordered_handoff_remains_unqualified_and_non_authorizing(self):
        h = self.new()
        self.assertEqual(h.status, "UNQUALIFIED_PREBIRTH_OBSERVED")
        self.assertEqual(h.submit_creation_claim(claim()),
                         "UNQUALIFIED_CREATION_CLAIMED")
        self.assertEqual(h.corroborate_job_completion(complete()),
                         "UNQUALIFIED_JOB_COMPLETION_CLAIMED")
        result = h.corroborate_birth(born())
        self.assertEqual(result["status"], "UNQUALIFIED_BIRTH_HANDOFF_CORRELATION")
        self.assertEqual(result["keeperPid"], 123)
        for method in (h.create_unit, h.issue_ack):
            with self.assertRaises(PermissionError):
                method()
        with self.assertRaises(TypeError):
            result["keeperPid"] = 444
        with self.assertRaises(ValueError):
            h.corroborate_birth(born())
        self.assertEqual(h.status, "UNQUALIFIED_QUARANTINED")

    def test_original_bytes_and_absence_cannot_be_reconstructed(self):
        intent, journal, absence = evidence()
        for fake_journal in (
            {"status": "UNQUALIFIED_FIXTURE_PREBIRTH_PERSISTED",
             "recordBytes": journal["recordBytes"][:-1]},
            {"status": "UNQUALIFIED_QUARANTINE_ON_REOPEN",
             "recordBytes": journal["recordBytes"]},
            {},
        ):
            with self.subTest(value=fake_journal), self.assertRaises(ValueError):
                ExclusiveUnitBirthHandoff(intent, fake_journal, absence)
        for fake_absence in ({**absence, "managerOwner": ":1.6", "extra": 1},
                             {**absence, "status": "UNIT_LOADED"},
                             {**absence, "unit": "other.service"}):
            with self.subTest(value=fake_absence), self.assertRaises(ValueError):
                ExclusiveUnitBirthHandoff(intent, journal, fake_absence)

    def test_immutable_observer_results_are_accepted_as_unqualified(self):
        intent, journal, absence = evidence()
        h = ExclusiveUnitBirthHandoff(
            intent, MappingProxyType(journal), MappingProxyType(absence))
        h.submit_creation_claim(MappingProxyType(claim()))
        h.corroborate_job_completion(MappingProxyType(complete()))
        snapshot = MappingProxyType({**born(),
                                     "properties": MappingProxyType(born()["properties"])})
        result = h.corroborate_birth(snapshot)
        self.assertEqual(result["status"], "UNQUALIFIED_BIRTH_HANDOFF_CORRELATION")
        with self.assertRaises(PermissionError):
            h.issue_ack()

    def test_no_creation_claim_or_wrong_sequence_quarantines(self):
        h = self.new()
        with self.assertRaises(ValueError):
            h.corroborate_birth(born())
        self.assertEqual(h.status, "UNQUALIFIED_QUARANTINED")
        h = self.new()
        h.submit_creation_claim(claim())
        with self.assertRaises(ValueError):
            h.submit_creation_claim(claim())
        self.assertEqual(h.status, "UNQUALIFIED_QUARANTINED")

    def test_wrong_job_mode_generation_owner_or_nonce_quarantines(self):
        for change in (
            {"mode": "replace"}, {"method": "StartUnit"},
            {"jobPath": "/org/freedesktop/systemd1/job/0"},
            {"managerOwner": ":1.6"}, {"nonce": "a"*64},
            {"attempt": 5}, {"prebirthSha256": "a"*64},
            {"unit": "other.service"}, {"extra": "not expected"},
        ):
            h = self.new()
            with self.subTest(change=change), self.assertRaises(ValueError):
                h.submit_creation_claim({**claim(), **change})
            self.assertEqual(h.status, "UNQUALIFIED_QUARANTINED")

    def test_manager_or_unit_mismatch_quarantines_and_clears_record(self):
        hatches = (
            {"owner": ":1.6"}, {"status": "OTHER"},
            {"properties": {**born()["properties"], "restartCount": 1}},
            {"properties": {**born()["properties"], "mainPid": 0}},
            {"properties": {**born()["properties"], "objectPath": "/wrong"}},
            {"properties": {**born()["properties"], "invocation": "x"*32}},
            {"properties": {**born()["properties"], "controlGroup": "/elsewhere"}},
        )
        for change in hatches:
            h = self.new()
            h.submit_creation_claim(claim())
            h.corroborate_job_completion(complete())
            with self.subTest(change=change), self.assertRaises(ValueError):
                h.corroborate_birth({**born(), **change})
            self.assertEqual(h.status, "UNQUALIFIED_QUARANTINED")
            with self.assertRaises(ValueError):
                h.corroborate_birth(born())

    def test_missing_failed_or_replayed_job_completion_quarantines(self):
        for wrong in ({"result": "failed"}, {"jobPath": "/org/freedesktop/systemd1/job/43"},
                      {"managerOwner": ":1.6"}, {"prebirthSha256": "a"*64},
                      {"unit": "other.service"}):
            h = self.new()
            h.submit_creation_claim(claim())
            with self.subTest(wrong=wrong), self.assertRaises(ValueError):
                h.corroborate_job_completion({**complete(), **wrong})
            self.assertEqual(h.status, "UNQUALIFIED_QUARANTINED")
        h = self.new()
        h.submit_creation_claim(claim())
        with self.assertRaises(ValueError):
            h.corroborate_birth(born())
        self.assertEqual(h.status, "UNQUALIFIED_QUARANTINED")
        h = self.new()
        h.submit_creation_claim(claim())
        h.corroborate_job_completion(complete())
        with self.assertRaises(ValueError):
            h.corroborate_job_completion(complete())
        self.assertEqual(h.status, "UNQUALIFIED_QUARANTINED")

    def test_crash_after_claim_blocks_adoption_and_ack(self):
        h = self.new()
        h.submit_creation_claim(claim())
        with self.assertRaises(PermissionError):
            h.recover()
        self.assertEqual(h.status, "UNQUALIFIED_QUARANTINED")
        with self.assertRaises(ValueError):
            h.corroborate_birth(born())
        with self.assertRaises(PermissionError):
            h.issue_ack()

    def test_canonical_looking_forgery_still_not_verified_authority(self):
        h = self.new()
        h.submit_creation_claim(claim())
        self.assertEqual(h.corroborate_job_completion(complete()),
                         "UNQUALIFIED_JOB_COMPLETION_CLAIMED")
        result = h.corroborate_birth(born())
        self.assertTrue(result["status"].startswith("UNQUALIFIED"))
        with self.assertRaises(PermissionError):
            h.create_unit()
