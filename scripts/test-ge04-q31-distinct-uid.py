#!/usr/bin/env python3
"""CI-safe Q3.1 tests; no root accounts or real supervisor provisioned."""
import json
from pathlib import Path
import subprocess
import sys
import unittest

SCRIPT = Path(__file__).with_name("ge04-q31-distinct-uid.py")


class Q31GateTests(unittest.TestCase):
    def run_fixture(self, *args):
        return subprocess.run([sys.executable, str(SCRIPT), *args],
                              capture_output=True, text=True, timeout=8)

    def assert_hold(self, result):
        self.assertEqual(result.returncode, 78, result.stderr)
        self.assertEqual(json.loads(result.stdout)["disposition"], "HOLD")

    def test_entrypoint_refuses_unqualified_start(self):
        self.assert_hold(self.run_fixture())

    def test_missing_operator_provisioning_refused(self):
        self.assert_hold(self.run_fixture("--isolated-test"))

    def test_worker_outside_disposable_path_refused(self):
        self.assert_hold(self.run_fixture("--worker", "client", "--directory", "/etc"))

    def test_worker_without_identity_inputs_refused(self):
        self.assert_hold(self.run_fixture("--worker", "server", "--directory", "/tmp/alix-ge04-q31-invalid"))

    def test_unprivileged_operator_cannot_launch_isolated_test(self):
        if sys.platform != "linux":
            self.skipTest("Linux only")
        if __import__("os").geteuid() == 0:
            self.skipTest("This negative test expects an unprivileged CI identity")
        self.assert_hold(self.run_fixture("--isolated-test", "--supervisor", "nobody",
                                          "--coordinator", "nobody", "--attacker", "nobody", "--group", "nogroup"))


if __name__ == "__main__":
    unittest.main()
