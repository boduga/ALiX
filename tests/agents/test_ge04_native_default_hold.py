"""GE-04 native default-build security hold regression.

Compiles the source with NO privileged-qualification macro and checks its
pre-operation refusal. Never invokes a privileged build or root controller.
"""
import os
from pathlib import Path
import shutil
import sys
import subprocess
import tempfile
import unittest

SOURCE = (Path(__file__).resolve().parents[2] /
          "native/ge04/cgroup-runtime-view-qualification.c")
MODES = ("run", "crash-pre-namespace", "crash-pinned", "crash-ready",
         "fail-mount", "fail-enable", "recover", "sweep-empty")


@unittest.skipUnless(sys.platform == "linux" and shutil.which("cc"),
                     "Native Linux compiler required")
class NativeHoldTests(unittest.TestCase):
    def test_sweep_refuses_unjournaled_existing_outer_source_contract(self):
        # A source guard only: no privileged cgroup fixture is ever executed.
        # This cannot replace the independently reviewed root recovery test.
        text = SOURCE.read_text()
        begin = text.index("static int sweep_empty(struct context *c) {")
        end = text.index("static int wait_injected_exit(", begin)
        body = text[begin:end]
        self.assertIn("if(!has_temp||strcmp(name,pending.name)", body)
        self.assertIn("(unsigned long long)s.st_dev!=pending.outer_dev", body)
        self.assertIn("(unsigned long long)s.st_ino!=pending.outer_ino", body)
        self.assertLess(body.index("if(!has_temp||"),
                        body.index("if(!open_outer(c)"))

    def test_default_binary_refuses_every_privileged_mode_before_setup(self):
        with tempfile.TemporaryDirectory(prefix="ge04-native-hold-") as temp:
            target = str(Path(temp) / "fixture")
            compile_result = subprocess.run(
                ["cc", "-std=gnu11", "-O2", "-Wall", "-Wextra",
                 str(SOURCE), "-o", target],
                stdin=subprocess.DEVNULL, capture_output=True, timeout=15,
                check=False)
            self.assertEqual(compile_result.returncode, 0,
                             compile_result.stderr.decode(errors="replace"))
            for mode in MODES:
                with self.subTest(mode=mode):
                    completed = subprocess.run(
                        [target, mode], stdin=subprocess.DEVNULL,
                        capture_output=True, timeout=2, check=False)
                    self.assertEqual(completed.returncode, 77)
                    self.assertEqual(completed.stdout, b"")
                    self.assertEqual(completed.stderr, b"")
            self.assertEqual(subprocess.run(
                [target, "invalid"], stdin=subprocess.DEVNULL,
                capture_output=True, timeout=2, check=False).returncode, 64)


if __name__ == "__main__":
    unittest.main()
