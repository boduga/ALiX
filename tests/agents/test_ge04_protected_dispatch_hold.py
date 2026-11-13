"""GE-04 B1 held-privilege tripwires; non-root, non-authorizing.

These checks do NOT qualify C source or prove behavior in privileged
runtime. Their only purpose is to catch accidental local removal of
the unconditional security hold or weakening of its review documentation.
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NATIVE = ROOT / "native/ge04"
SECURITY = ROOT / "docs/security"


@unittest.skipUnless(sys.platform == "linux", "Linux native qualification only")
class HeldDispatchReviewGates(unittest.TestCase):
    def test_root_controller_is_unconditionally_default_disabled(self):
        source = (NATIVE / "protected-root-controller.c").read_text()
        self.assertRegex(source, r"int\s+main\s*\([^)]*\)\s*\{\s*return\s+77\s*;\s*(?:/\*[^*]*\*/\s*)?\}")
        self.assertNotRegex(source, r"#\s*(if|ifdef|ifndef)")
        if os.geteuid() == 0:
            self.skipTest("Do not execute native candidate as root")
        if not shutil.which("cc"):
            self.skipTest("No C compiler")
        with tempfile.TemporaryDirectory(prefix="ge04-hold-entry-") as tmp:
            executable = Path(tmp) / "disabled"
            compiled = subprocess.run(
                ["cc", "-std=gnu11", "-Wall", "-Wextra", "-Werror",
                 str(NATIVE / "protected-root-controller.c"), "-o",
                 str(executable)], capture_output=True, text=True, timeout=20)
            self.assertEqual(compiled.returncode, 0, compiled.stderr)
            for args in ([], ["--enable"], ["--approve"], ["run"]):
                with self.subTest(args=args):
                    run = subprocess.run([str(executable), *args],
                                         capture_output=True, timeout=2)
                    self.assertEqual(run.returncode, 77)
                    self.assertEqual(run.stdout, b"")
                    self.assertEqual(run.stderr, b"")

    def test_native_dispatch_apis_still_refuse_and_have_no_sender(self):
        preparation = (NATIVE / "protected-dispatch-preparation.c").read_text()
        transaction = (NATIVE / "protected-systemd-transaction.c").read_text()
        request = (NATIVE / "protected-systemd-request.c").read_text()
        intent = (NATIVE / "protected-dispatch-intent.c").read_text()
        for name, source in [
            ("preparation", preparation), ("transaction", transaction),
            ("request", request), ("intent", intent)
        ]:
            with self.subTest(name=name):
                self.assertNotRegex(source, r"\bsd_bus_(send|call)\s*\(")
                self.assertNotRegex(source, r"\bsd_bus_(call_async|send_with_reply)\s*\(")
        self.assertIn("return refuse(tx); /* SECURITY HOLD:", preparation)
        self.assertIn("return deny(EPERM); /* SECURITY HOLD:", transaction)
        self.assertNotIn("tx->request_in_flight = 1", preparation)
        self.assertNotIn("tx->request_cookie =", preparation)
        self.assertIn("O_EXCL", intent)
        self.assertIn("fsync(file)", intent)
        self.assertIn("fsync(directory)", intent)
        self.assertNotRegex(intent, r"\b(unlink|unlinkat|rename|renameat)\s*\(")

    def test_authoritative_gates_and_new_review_remain_open(self):
        original = (SECURITY / "ge04-r1b1-closeout-gates.md").read_text()
        packet = (SECURITY / "ge04-protected-root-controller-phase3b4c-review.md").read_text()
        for label in "ABCDEFGH":
            with self.subTest(label=label):
                self.assertIn(f"B1-{label}:", original)
                self.assertIn(f"B1-{label}", packet)
        self.assertIn("NO-GO", packet)
        self.assertIn("No command in this packet grants permission", packet)
        self.assertIn("controller", packet.lower())
        self.assertIn("independent human", packet.lower())
