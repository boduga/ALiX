"""Unprivileged native signal-dispatch poisoning tests for Phase 3A.

Link-time wrappers simulate queued libsystemd messages and root identity
without running any process as root, opening a system bus, or creating a unit.
"""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[2]
NATIVE = REPO / "native/ge04"


@unittest.skipUnless(sys.platform == "linux" and shutil.which("cc") and
                     shutil.which("pkg-config"), "Linux C toolchain required")
class NativeDispatchTests(unittest.TestCase):
    def test_queued_fixed_unit_event_error_and_flood_poison(self):
        if subprocess.run(["pkg-config", "--exists", "libsystemd"],
                          capture_output=True, check=False).returncode != 0:
            self.skipTest("libsystemd unavailable")
        source = r"""
#include "protected-systemd-transaction.h"
#include <errno.h>
#include <stdint.h>
#include <stdlib.h>
#include <sys/types.h>
static struct ge04_systemd_transaction tx;
static int mode, calls;

uid_t __wrap_getuid(void) { return 0; }
uid_t __wrap_geteuid(void) { return 0; }
gid_t __wrap_getgid(void) { return 0; }
gid_t __wrap_getegid(void) { return 0; }

int __wrap_ge04_attempt_recheck(
    const struct ge04_prebirth_claim *claim,
    const struct ge04_attempt_custody *attempt) {
    (void)claim; (void)attempt; return 0;
}
int __wrap_ge04_prebirth_recheck(
    const struct ge04_prebirth_claim *claim,
    const struct ge04_journal_custody *journal) {
    (void)claim; (void)journal; return 0;
}
int __wrap_sd_bus_process(sd_bus *bus, sd_bus_message **message) {
    (void)bus; (void)message; ++calls;
    if (mode == 1) { tx.poisoned = 1; return 1; }
    if (mode == 2) return -EIO;
    return 1; /* never drains, so 64-message cap must refuse */
}
int main(int argc, char **argv) {
    if (argc != 2) return 90;
    mode = atoi(argv[1]);
    ge04_systemd_transaction_init(&tx);
    tx.bus = (sd_bus *)(uintptr_t)1;
    tx.job_slot = (sd_bus_slot *)(uintptr_t)1;
    tx.owner[0] = ':';
    tx.owner[1] = '1';
    tx.owner[2] = '.';
    tx.owner[3] = '5';
    tx.owner[4] = 0;
    tx.subscribed = 1;
    int rc = ge04_systemd_recheck_original(NULL, NULL, NULL, &tx);
    if (rc != -1 || errno != EPERM || tx.poisoned != 1) return 91;
    if ((mode == 1 || mode == 2) && calls != 1) return 92;
    if (mode == 3 && calls != 64) return 93;
    return 0;
}
"""
        with tempfile.TemporaryDirectory(prefix="ge04-native-dispatch-") as temp:
            directory = Path(temp)
            harness = directory / "dispatch.c"
            harness.write_text(source)
            target = directory / "dispatch"
            libs = subprocess.run(["pkg-config", "--libs", "libsystemd"],
                                  capture_output=True, text=True,
                                  check=True).stdout.split()
            wrapper_names = ("getuid", "geteuid", "getgid", "getegid",
                             "ge04_attempt_recheck", "ge04_prebirth_recheck",
                             "sd_bus_process")
            build = subprocess.run(
                ["cc", "-std=gnu11", "-O2", "-Wall", "-Wextra", "-Werror",
                 "-Wpedantic", "-Wconversion", "-Wshadow", "-Wformat=2",
                 "-I", str(NATIVE), str(harness),
                 *(str(NATIVE / name) for name in (
                     "protected-systemd-transaction.c",
                     "protected-attempt-fence.c",
                     "protected-prebirth-journal.c")),
                 *(f"-Wl,--wrap={name}" for name in wrapper_names),
                 *libs, "-o", str(target)],
                capture_output=True, text=True, timeout=25, check=False)
            self.assertEqual(build.returncode, 0, build.stderr)
            for mode in ("1", "2", "3"):
                with self.subTest(mode=mode):
                    run = subprocess.run([str(target), mode],
                                         capture_output=True, timeout=2)
                    self.assertEqual(run.returncode, 0, run.stderr)
