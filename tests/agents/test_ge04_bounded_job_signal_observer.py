"""GE-04 bounded systemd job-event subprocess, unprivileged diagnostic tests."""
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest import mock

SRC = Path(__file__).resolve().parents[2] / "native/ge04"
sys.path.insert(0, str(SRC))
import bounded_job_signal_observer as bounded
from bootstrap_binding import UNIT

EXPECTED = {
    "managerOwner": ":1.5",
    "jobPath": "/org/freedesktop/systemd1/job/42",
    "unit": UNIT,
}


def witness():
    return {"status": "UNQUALIFIED_LIVE_SYSTEMD_JOB_SIGNAL",
            "managerOwner": ":1.5",
            "jobPath": EXPECTED["jobPath"], "unit": UNIT, "result": "done"}


class BoundedJobTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="ge04-bounded-job-")
        self.addCleanup(self.tmp.cleanup)

    def worker(self, code):
        path = Path(self.tmp.name) / "worker.py"
        path.write_text(code)
        return path

    def observe(self, path, seconds=.8, **kwargs):
        with mock.patch.object(bounded, "WORKER", path):
            return bounded.observe_job_signal_bounded(
                EXPECTED, time.monotonic() + seconds, **kwargs)

    @unittest.skipIf(os.geteuid() == 0, "Root fixture execution is denied")
    def test_hung_worker_is_killed_and_reaped_by_deadline(self):
        start = time.monotonic()
        with self.assertRaises(TimeoutError):
            self.observe(self.worker("import time\ntime.sleep(30)\n"), seconds=.2)
        self.assertLess(time.monotonic() - start, 2)

    @unittest.skipIf(os.geteuid() == 0, "Root fixture execution is denied")
    def test_excessive_output_fails_without_unbounded_buffer(self):
        with self.assertRaises(ValueError):
            self.observe(self.worker("import sys\nsys.stdout.write('X'*10000000)\n"))

    @unittest.skipIf(os.geteuid() == 0, "Root fixture execution is denied")
    def test_bad_exit_empty_and_noncanonical_witness_refuse(self):
        outputs = [
            "import sys\nsys.exit(77)\n",
            "print('not json')\n",
            "print('{}')\n",
            "print(" + repr(json.dumps(witness(), separators=(",", ":"))) + ")\n",
            "print(" + repr(json.dumps({**witness(), "managerOwner": ":1.6"},
                                      sort_keys=True, separators=(",", ":"))) + ")\n",
            "print(" + repr(json.dumps({**witness(), "extra": "x"},
                                      sort_keys=True, separators=(",", ":"))) + ")\n",
        ]
        for code in outputs:
            with self.subTest(code=code[:40]), self.assertRaises(ValueError):
                self.observe(self.worker(code))

    @unittest.skipIf(os.geteuid() == 0, "Root fixture execution is denied")
    def test_canonical_fake_response_does_not_grant_authority(self):
        response = (json.dumps(witness(), sort_keys=True, separators=(",", ":")) +
                    "\n")
        result = self.observe(self.worker("import sys\nsys.stdout.write(" +
                                          repr(response) + ")\n"))
        self.assertEqual(result["status"], "UNQUALIFIED_LIVE_SYSTEMD_JOB_SIGNAL")
        with self.assertRaises(TypeError):
            result["status"] = "AUTHORIZED"

    def test_root_and_bad_window_refused_without_spawn(self):
        with mock.patch.object(bounded.os, "geteuid", return_value=0):
            with self.assertRaises(PermissionError):
                bounded.observe_job_signal_bounded(
                    EXPECTED, time.monotonic() + 1)
        for interval in (0, -1, 7, float("nan")):
            with self.subTest(interval=interval), self.assertRaises(
                    (ValueError, PermissionError)):
                bounded.observe_job_signal_bounded(
                    EXPECTED, time.monotonic() + 1, window_ms=interval)
        with self.assertRaises(PermissionError):
            bounded.observe_job_signal_bounded(EXPECTED, time.monotonic() + 9)

    @unittest.skipIf(os.geteuid() == 0, "Root fixture execution is denied")
    def test_real_absent_unit_never_yields_authority(self):
        try:
            observed = bounded.observe_job_signal_bounded(
                EXPECTED, time.monotonic() + 2.5, window_ms=100)
        except (ValueError, TimeoutError):
            return
        self.assertEqual(observed["status"], "UNQUALIFIED_LIVE_SYSTEMD_JOB_SIGNAL")
