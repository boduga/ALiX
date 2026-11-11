"""GE-04 bounded dispatch evidence: adversarial, no bus or root."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "native/ge04"))
from bounded_dispatch_evidence import DispatchEvidenceDiagnostic

JOB = "/org/freedesktop/systemd1/job/123"


def event(kind, ms, **overrides):
    base = dict(kind=kind, manager=":1.2", requestSerial=9,
                jobPath=JOB if kind in ("REPLY", "JOB_REMOVED") else "",
                elapsedMs=ms)
    return {**base, **overrides}


class BoundedDispatchEvidenceTests(unittest.TestCase):
    def test_full_sequence_still_unqualified(self):
        d = DispatchEvidenceDiagnostic(":1.2", 9)
        for kind, ms in zip(("INTENT", "SEND_ATTEMPTED", "REPLY", "JOB_REMOVED"),
                            (0, 1, 2, 3)):
            result = d.observe(event(kind, ms))
            self.assertFalse(result["authorized"])
            self.assertEqual(result["gatesCleared"], ())
        self.assertEqual(d.status, "UNQUALIFIED")
        with self.assertRaises(ValueError):
            d.observe(event("JOB_REMOVED", 4))
        self.assertEqual(d.status, "QUARANTINED")

    def test_substitutions_and_ambiguities_quarantine(self):
        cases = [
            [event("REPLY", 1)],
            [event("INTENT", 0), event("INTENT", 1)],
            [event("INTENT", 0), event("SEND_ATTEMPTED", 3001)],
            [event("INTENT", 0), event("SEND_ATTEMPTED", 1, manager=":1.3")],
            [event("INTENT", 0), event("SEND_ATTEMPTED", 1, requestSerial=10)],
            [event("INTENT", 0), event("SEND_ATTEMPTED", 1, elapsedMs=True)],
            [event("INTENT", 2), event("SEND_ATTEMPTED", 1)],
            [event("INTENT", 0), event("SEND_ATTEMPTED", 1),
             event("REPLY", 2), event("JOB_REMOVED", 3, jobPath=JOB+"4")],
        ]
        for events in cases:
            with self.subTest(events=events):
                d = DispatchEvidenceDiagnostic(":1.2", 9)
                with self.assertRaises(ValueError):
                    for e in events:
                        d.observe(e)
                self.assertEqual(d.status, "QUARANTINED")

    def test_loss_and_privileged_actions_never_recover(self):
        for action in ("process_loss", "authorize_send", "issue_ack"):
            d = DispatchEvidenceDiagnostic(":1.2", 9)
            d.observe(event("INTENT", 0))
            if action == "process_loss":
                d.process_loss()
            else:
                with self.assertRaises(PermissionError):
                    getattr(d, action)()
            self.assertEqual(d.status, "QUARANTINED")
            with self.assertRaises(ValueError):
                d.observe(event("SEND_ATTEMPTED", 1))
