#!/usr/bin/env python3
"""Non-production process-boundary regression tests."""
import importlib.util
import json
import subprocess
import sys
import unittest
from pathlib import Path

SOURCE = Path(__file__).with_name("ge04-q32-process-effect-probe.py")
spec = importlib.util.spec_from_file_location("ge04_process_probe", SOURCE)
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class ProcessEffectProbeTests(unittest.TestCase):
    def test_default_cli_is_hold(self):
        result = subprocess.run([sys.executable, "-B", str(SOURCE)], capture_output=True,
                                text=True, check=False)
        self.assertEqual(result.returncode, 78)
        self.assertFalse(json.loads(result.stdout)["qualified_effect_authority"])

    def test_revocation_first_blocks_real_syscall(self):
        result = probe.run_scenario("revoke-first")
        self.assertEqual(result["scratch_effects"], 0)
        self.assertEqual(result["scratch_bytes"], "")
        self.assertEqual(result["reason"], "UNTRUSTED_IPC_DENIED")

    def test_effect_first_serializes_actual_syscall(self):
        result = probe.run_scenario("effect-first")
        self.assertEqual(result["scratch_effects"], 1)
        self.assertEqual(result["scratch_bytes"], "X")
        self.assertFalse(result["qualified_effect_authority"])

    def test_delegated_fd_is_rejected_and_closed(self):
        result = probe.run_scenario("effect-first", pass_fd=True)
        self.assertTrue(result["ancillary_rejected"])
        self.assertEqual(result["scratch_effects"], 1)
        self.assertEqual(result["reason"], "UNTRUSTED_IPC_DENIED")

    def test_no_arbitrary_scenario(self):
        with self.assertRaises(ValueError):
            probe.run_scenario("arbitrary")

    def test_repeat_process_is_disposable(self):
        first = probe.run_scenario("effect-first")
        second = probe.run_scenario("revoke-first")
        self.assertEqual((first["scratch_bytes"], second["scratch_bytes"]), ("X", ""))


if __name__ == "__main__":
    unittest.main()
