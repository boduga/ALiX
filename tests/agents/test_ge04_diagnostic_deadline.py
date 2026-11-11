"""Native monotonic deadline diagnostic: no privileged operations."""
from pathlib import Path
import subprocess
import tempfile
import unittest

SRC = Path(__file__).resolve().parents[2] / "native/ge04"
HARNESS = r"""
#define _POSIX_C_SOURCE 200809L
#include "diagnostic-deadline.h"
#include <assert.h>
#include <errno.h>
#include <stdint.h>
#include <time.h>
int main(void) {
    struct ge04_diagnostic_deadline d;
    uint64_t remaining = 0;
    assert(ge04_deadline_begin(&d, 1000000000ULL) == 0);
    assert(ge04_deadline_remaining(&d, &remaining) == 0);
    assert(remaining > 0 && remaining <= 1000000000ULL);
    assert(!ge04_deadline_can_dispatch(&d));
    assert(!ge04_deadline_can_ack(&d));
    ge04_deadline_quarantine(&d);
    assert(ge04_deadline_check(&d) < 0);
    assert(d.quarantined);
    assert(ge04_deadline_begin(&d, 0) < 0);
    assert(d.quarantined);
    assert(ge04_deadline_begin(&d, UINT64_MAX) < 0);
    assert(d.quarantined);
    assert(ge04_deadline_begin(&d, 1000000ULL) == 0);
    struct timespec pause = {.tv_sec=0, .tv_nsec=10000000L};
    nanosleep(&pause, 0);
    errno = 0;
    assert(ge04_deadline_check(&d) < 0);
    assert(errno == ETIMEDOUT);
    assert(d.quarantined);
    assert(ge04_deadline_check(&d) < 0);
    assert(!ge04_deadline_can_dispatch(&d));
    assert(!ge04_deadline_can_ack(&d));
    return 0;
}
"""


class DiagnosticDeadlineTests(unittest.TestCase):
    def test_monotonic_budget_and_absorbing_quarantine(self):
        with tempfile.TemporaryDirectory(prefix="ge04-deadline-") as directory:
            path = Path(directory)
            (path / "main.c").write_text(HARNESS)
            subprocess.run(["cc", "-std=c11", "-Wall", "-Wextra", "-Werror",
                            "-I", str(SRC), str(path / "main.c"),
                            str(SRC / "diagnostic-deadline.c"),
                            "-o", str(path / "main")], check=True, timeout=20)
            subprocess.run([str(path / "main")], check=True, timeout=5)

    def test_no_transport_or_privilege(self):
        code = (SRC / "diagnostic-deadline.c").read_text()
        for forbidden in ("sd_bus_send(", "sd_bus_call(", "execve(",
                          "setuid(", "fork(", "system(", "StartTransientUnit"):
            self.assertNotIn(forbidden, code)
