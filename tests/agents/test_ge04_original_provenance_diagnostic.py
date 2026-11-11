"""Adversarial unprivileged tests for B1-B/C non-authorizing diagnostics."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "native/ge04"))
from original_provenance_diagnostic import OriginalProvenanceDiagnostic

BASE = dict(boot="boot-1", attempt="attempt-1", manager=":1.4",
            unit="alix-ge04-qualification.service", requestSerial=42,
            invocation="inv-1", keeperGeneration=3, keeperPidfd=10,
            namespace="mnt:[101]", mountId=11, superblock="0:29",
            mountRoot="/", unitCgroup="unit-fd", outerCgroup="outer-fd",
            launcherCgroup="launcher-fd", payloadCgroup="payload-fd")


class OriginalProvenanceTests(unittest.TestCase):
    def test_matching_claims_never_authorize(self):
        diagnostic = OriginalProvenanceDiagnostic(BASE)
        result = diagnostic.compare(dict(BASE))
        self.assertTrue(result["equal"])
        self.assertFalse(result["authority"])
        self.assertEqual(result["gatesCleared"], ())
        self.assertIn("UNQUALIFIED", diagnostic.status)
        with self.assertRaises(TypeError):
            result["authority"] = True

    def test_each_identity_substitution_quarantines(self):
        for key, value in BASE.items():
            with self.subTest(key=key):
                changed = dict(BASE)
                changed[key] = value + 1 if type(value) is int else value + "-swapped"
                diagnostic = OriginalProvenanceDiagnostic(BASE)
                with self.assertRaises(ValueError):
                    diagnostic.compare(changed)
                self.assertEqual(diagnostic.status, "QUARANTINED")
                with self.assertRaises(ValueError):
                    diagnostic.compare(BASE)

    def test_missing_extra_and_invalid_identity_refuse(self):
        for changed in ({k: v for k, v in BASE.items() if k != "mountRoot"},
                        {**BASE, "extra": "forged"},
                        {**BASE, "requestSerial": 0},
                        {**BASE, "mountId": True},
                        {**BASE, "namespace": ""}):
            with self.subTest(changed=changed):
                with self.assertRaises(ValueError):
                    OriginalProvenanceDiagnostic(changed)

    def test_replay_quarantines_even_after_equal_comparison(self):
        diagnostic = OriginalProvenanceDiagnostic(BASE)
        diagnostic.compare(BASE)
        with self.assertRaises(ValueError):
            diagnostic.compare(BASE)
        self.assertEqual(diagnostic.status, "QUARANTINED")

    def test_send_and_ack_always_refuse(self):
        for method in ("authorize_send", "issue_ack"):
            diagnostic = OriginalProvenanceDiagnostic(BASE)
            with self.subTest(method=method), self.assertRaises(PermissionError):
                getattr(diagnostic, method)()
            self.assertEqual(diagnostic.status, "QUARANTINED")
