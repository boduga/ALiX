"""GE-04 Phase 3 native systemd connection contract, unprivileged-only.

Compiles native libsystemd source in a temporary directory. The compiled
controller always exits 77; never invoke root, subscribe, or create units.
"""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[2]
NATIVE = REPO / "native/ge04"
FILES = ("protected-systemd-transaction.c", "protected-attempt-fence.c",
         "protected-prebirth-journal.c")
CFLAGS = ("-std=gnu11", "-O2", "-Wall", "-Wextra", "-Werror",
          "-Wpedantic", "-Wconversion", "-Wshadow", "-Wformat=2")


@unittest.skipUnless(sys.platform == "linux" and shutil.which("cc") and
                     shutil.which("pkg-config"), "Linux native toolchain required")
class SystemdNativeContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        flags = subprocess.run(
            ["pkg-config", "--exists", "libsystemd"],
            stdin=subprocess.DEVNULL, capture_output=True, check=False)
        if flags.returncode != 0:
            raise unittest.SkipTest("libsystemd headers unavailable")
        cls.tmp = tempfile.TemporaryDirectory(prefix="ge04-native-sdbus-")
        cls.root = Path(cls.tmp.name)
        harness = cls.root / "systemd-check.c"
        harness.write_text(r"""
#include "protected-systemd-transaction.h"
#include <errno.h>
#include <string.h>
#include <stdio.h>

int main(int argc, char **argv) {
    if (argc != 2) return 90;
    struct ge04_systemd_transaction tx;
    ge04_systemd_transaction_init(&tx);
    if (strcmp(argv[1], "default") == 0) {
        if (tx.bus || tx.job_slot || tx.owner[0] ||
            tx.subscribed || tx.poisoned) return 91;
        ge04_systemd_transaction_close(&tx);
        return tx.bus || tx.subscribed ? 92 : 0;
    }
    if (strcmp(argv[1], "create") == 0) {
        if (ge04_systemd_create_exclusive(&tx) != -1 || errno != EPERM ||
            tx.poisoned != 1) return 93;
        ge04_systemd_transaction_close(&tx);
        return tx.poisoned == 1 && tx.bus == NULL ? 0 : 94;
    }
    if (strcmp(argv[1], "subscribe") == 0) {
        if (ge04_systemd_subscribe_original(NULL, NULL, NULL, &tx) != -1 ||
            errno != EPERM) return 95;
        return tx.bus == NULL && tx.job_slot == NULL ? 0 : 96;
    }
    if (strcmp(argv[1], "recheck") == 0) {
        if (ge04_systemd_recheck_original(NULL, NULL, NULL, &tx) != -1 ||
            errno != EPERM) return 97;
        return 0;
    }
    if (strcmp(argv[1], "poison") == 0) {
        tx.poisoned = 1;
        ge04_systemd_transaction_close(&tx);
        return tx.poisoned == 1 ? 0 : 98;
    }
    return 99;
}
""")
        libs = subprocess.run(["pkg-config", "--libs", "libsystemd"],
                              capture_output=True, text=True, check=True).stdout.split()
        cls.testbin = cls.root / "check"
        cls.controller = cls.root / "held-controller"
        for target, sources in (
            (cls.testbin, [str(harness)]),
            (cls.controller, [str(NATIVE / "protected-root-controller.c")]),
        ):
            run = subprocess.run(
                ["cc", *CFLAGS, "-I", str(NATIVE), *sources,
                 *(str(NATIVE / name) for name in FILES),
                 *libs, "-o", str(target)],
                stdin=subprocess.DEVNULL, capture_output=True, text=True,
                check=False, timeout=25)
            if run.returncode != 0:
                raise AssertionError("Native compile/link error: " + run.stderr)

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, "tmp"):
            cls.tmp.cleanup()

    def call(self, target, *args):
        return subprocess.run([str(target), *args], stdin=subprocess.DEVNULL,
                              capture_output=True, check=False, timeout=2)

    def test_transaction_empty_and_close_are_safe(self):
        self.assertEqual(self.call(self.testbin, "default").returncode, 0)

    def test_exclusive_creation_is_always_denied_and_poisoned(self):
        self.assertEqual(self.call(self.testbin, "create").returncode, 0)

    def test_poison_survives_close(self):
        self.assertEqual(self.call(self.testbin, "poison").returncode, 0)

    def test_unprivileged_subscription_and_custody_recheck_refused(self):
        if os.geteuid() == 0:
            self.skipTest("Never invoke root-only candidate")
        for mode in ("subscribe", "recheck"):
            with self.subTest(mode=mode):
                self.assertEqual(self.call(self.testbin, mode).returncode, 0)

    def test_linked_controller_remains_unconditionally_disabled(self):
        if os.geteuid() == 0:
            self.skipTest("Never invoke controller as root")
        for args in ((), ("run",), ("--enable",), ("--approve",)):
            with self.subTest(args=args):
                out = self.call(self.controller, *args)
                self.assertEqual(out.returncode, 77)
                self.assertEqual(out.stdout, b"")
                self.assertEqual(out.stderr, b"")

    def test_no_native_creation_call_in_transaction_source(self):
        source = (NATIVE / "protected-systemd-transaction.c").read_text()
        # Only allowed sd_bus_call_method targets are Subscribe/Unsubscribe.
        import re
        targets = re.findall(
            r'sd_bus_call_method\s*\([^;]*?GE04_MANAGER_IFACE,\s*"([^"]+)"',
            source, flags=re.S)
        self.assertEqual(sorted(targets), ["Subscribe", "Unsubscribe"])
        self.assertIn("return deny(EPERM); /* SECURITY HOLD", source)
