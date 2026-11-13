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

    def test_cleanup_requires_pinned_ownership_and_rechecks_before_kill(self):
        # Source invariant only; independently authorized VM tests are still
        # necessary to verify true kernel custody and race behavior.
        text = SOURCE.read_text()
        begin = text.index("static int cleanup_until(struct context *c,")
        end = text.index("static int cleanup(struct context *c,", begin)
        body = text[begin:end]
        self.assertIn("if(!c->owned)return 0;", body)
        self.assertNotIn("if(!c->owned)return 1;", body)
        destructive = body.index('write(c->killfd,"1",1)')
        self.assertLess(body.index("int current_a,current_b;"), destructive)
        self.assertLess(body.index("if(!bindings(c)||!known_children(c->outer,0,"), destructive)
        self.assertLess(body.index("current_a!=a||current_b!=b"), destructive)
        self.assertLess(body.index('inner_custody(c,"launcher"', body.index("int current_a,current_b;")), destructive)
        self.assertLess(body.index('inner_custody(c,"payload"', body.index("int current_a,current_b;")), destructive)

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
