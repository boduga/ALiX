"""GE-04-R2L fail-closed launcher contract tests, no privileged execution."""
import importlib.util
from pathlib import Path
import subprocess
import sys
import unittest
from unittest import mock

SOURCE = Path(__file__).resolve().parents[2] / "scripts/ge04-r2l-cross-uid-qualification.py"
spec = importlib.util.spec_from_file_location("ge04_r2l", SOURCE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CrossUidLauncherTests(unittest.TestCase):
    def test_without_isolated_flag_exits_hold(self):
        result = subprocess.run([sys.executable, "-B", str(SOURCE)],
                                text=True, capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 78)
        self.assertIn('"disposition": "HOLD"', result.stdout)

    def test_nonroot_operator_cannot_launch(self):
        with mock.patch.object(module.os, "geteuid", return_value=1000):
            with self.assertRaisesRegex(RuntimeError, "root operator"):
                module.isolated_test()

    def test_three_role_uids_distinct_nonroot(self):
        self.assertEqual(len(set(module.ROLES.values())), 3)
        self.assertTrue(all(uid > 0 for uid in module.ROLES.values()))

    def test_launcher_pins_denied_response(self):
        self.assertEqual(module.DENIED, "DENIED GE04_SECURITY_HOLD")


if __name__ == "__main__":
    unittest.main()
