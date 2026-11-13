"""GE-04 isolated observer process limits: unprivileged diagnostic only."""
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2] / "native/ge04"
sys.path.insert(0, str(ROOT))
import bounded_phase_observer as bounded
from test_ge04_phase_controller import original, event
from phase_controller import ReadOnlyPhaseController


class BoundedObserverTests(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.TemporaryDirectory(prefix="ge04-bounded-observer-")
        self.addCleanup(self.work.cleanup)

    def worker(self, content):
        path = Path(self.work.name) / "worker.py"
        path.write_text(content)
        return path

    def observe(self, path, seconds=1):
        with mock.patch.object(bounded, "WORKER", path):
            return bounded.observe_bounded(original(), time.monotonic() + seconds)

    def test_real_absent_fixed_unit_fails_closed(self):
        # If the fixed unit becomes present, the checked result is still
        # UNQUALIFIED and cannot authorize any native ACK.
        try:
            result = bounded.observe_bounded(original(), time.monotonic() + 2)
        except (ValueError, TimeoutError):
            return
        self.assertEqual(result["status"],
                         "UNQUALIFIED_MANAGER_KERNEL_CORRELATION")

    def test_terminate_stuck_observer_with_deadline(self):
        path = self.worker("import time\ntime.sleep(30)\n")
        start = time.monotonic()
        with self.assertRaises(TimeoutError):
            self.observe(path, seconds=0.2)
        self.assertLess(time.monotonic() - start, 3)

    def test_malformed_duplicate_and_wrong_generation_refused(self):
        cases = (
            "import sys\nsys.stdout.write('not JSON\\n')\n",
            "import sys\nsys.stdout.write('x'*10000000)\n",
            "import sys\nsys.exit(77)\n",
            "import sys\nsys.stdout.write('{}\\n')\n",
        )
        for code in cases:
            with self.subTest(code=code), self.assertRaises(ValueError):
                self.observe(self.worker(code))
        data = {"status": "UNQUALIFIED_MANAGER_KERNEL_CORRELATION",
                "managerOwner": ":1.5",
                "kernel": {"status": "UNQUALIFIED_KERNEL_UNIT_CORRELATION",
                           "pid": 102, "startticks": 4567}}
        raw = json.dumps(data, sort_keys=True, separators=(",", ":")) + "\n"
        with self.assertRaises(ValueError):
            self.observe(self.worker("import sys\nsys.stdout.write(" + repr(raw) + ")\n"))

    def test_validly_shaped_test_worker_is_still_unqualified(self):
        # This demonstrates public format forgery; no security authority.
        data = {"status": "UNQUALIFIED_MANAGER_KERNEL_CORRELATION",
                "managerOwner": ":1.5",
                "kernel": {"status": "UNQUALIFIED_KERNEL_UNIT_CORRELATION",
                           "pid": 101, "startticks": 4567}}
        raw = json.dumps(data, sort_keys=True, separators=(",", ":")) + "\n"
        result = self.observe(self.worker("import sys\nsys.stdout.write(" + repr(raw) + ")\n"))
        self.assertEqual(result["status"], "UNQUALIFIED_MANAGER_KERNEL_CORRELATION")
        ctrl = ReadOnlyPhaseController(original(),
                                       observer=lambda _: result)
        self.assertEqual(ctrl.accept(event("INTENT"), time.monotonic() + 1),
                         "UNQUALIFIED_PHASE_OBSERVATION")
        with self.assertRaises(PermissionError):
            ctrl.issue_ack()
