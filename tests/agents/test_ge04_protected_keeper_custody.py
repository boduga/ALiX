"""GE-04 4A1 production C keeper pidfd/procfs source, unprivileged tests.

Uses the actual native C parser with read-only /proc/self/stat and checks
that self-cgroup cannot impersonate the fixed unit. Never invokes root.
"""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

NATIVE = Path(__file__).resolve().parents[2] / "native/ge04"


@unittest.skipUnless(sys.platform == "linux" and shutil.which("cc") and
                     shutil.which("pkg-config"), "Linux native toolchain")
class KeeperCustodyTests(unittest.TestCase):
    def test_native_generation_parser_and_root_denial(self):
        if os.geteuid() == 0:
            self.skipTest("Never run fixture as root")
        code = r"""
#include "protected-keeper-custody.c"
#include <stdlib.h>

int main(void) {
    pid_t pid = getpid();
    char statbuf[PROC_LIMIT];
    size_t length = 0;
    uint64_t ticks = 0;
    if (read_proc(pid, "stat", statbuf, sizeof(statbuf), &length) < 0 ||
        parse_startticks(statbuf, length, pid, &ticks) < 0 || !ticks) return 1;
    uint64_t wrong = 0;
    if (parse_startticks(statbuf, length, pid + 1, &wrong) == 0) return 2;
    if (parse_startticks("1 (a) S 1 2 3\n", 14, 1, &wrong) == 0)
        return 3;
    if (parse_startticks(NULL, 0, pid, &wrong) == 0) return 4;
    if (sample(pid, &wrong) == 0) return 5; /* no fixed unit adoption */
    struct ge04_keeper_custody held;
    ge04_keeper_custody_init(&held);
    if (held.pidfd != -1 || held.held || held.startticks) return 6;
    if (ge04_keeper_recheck_unqualified(&held) != -1 ||
        errno != EPERM) return 7;
    if (ge04_keeper_pin_unqualified(NULL,NULL,NULL,NULL,&held) != -1 ||
        errno != EPERM) return 8;
    ge04_keeper_custody_close(&held);
    if (held.pidfd != -1 || held.held) return 9;
    /* A forged pidfd number and PID cannot grant root custody. */
    held.pidfd = 1;
    held.pid = pid;
    held.startticks = ticks;
    held.held = 1;
    if (ge04_keeper_recheck_unqualified(&held) != -1 ||
        errno != EPERM) return 10;
    /* Do not close a borrowed/stdout FD. */
    held.held = 0;
    ge04_keeper_custody_close(&held);
    return 0;
}
"""
        with tempfile.TemporaryDirectory(prefix="ge04-keeper-custody-") as tmp:
            root = Path(tmp)
            harness = root / "check.c"
            harness.write_text(code)
            target = root / "check"
            lib = subprocess.run(["pkg-config", "--libs", "libsystemd"],
                                 capture_output=True, check=True,
                                 text=True).stdout.split()
            command = ["cc", "-std=gnu11", "-O2", "-Wall", "-Wextra",
                       "-Werror", "-Wpedantic", "-Wconversion", "-Wshadow",
                       "-Wformat=2", "-I", str(NATIVE), str(harness),
                       *(str(NATIVE / name) for name in (
                           "protected-systemd-birth-observer.c",
                           "protected-systemd-transaction.c",
                           "protected-prebirth-journal.c",
                           "protected-attempt-fence.c")),
                       *lib, "-o", str(target)]
            compiled = subprocess.run(command, capture_output=True,
                                      text=True, timeout=25)
            self.assertEqual(compiled.returncode, 0, compiled.stderr)
            result = subprocess.run([str(target)], capture_output=True,
                                    timeout=2)
            self.assertEqual(result.returncode, 0, result.stderr)
