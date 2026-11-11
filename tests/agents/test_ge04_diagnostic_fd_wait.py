"""Standalone unprivileged readiness-only deadline tests."""
from pathlib import Path
import subprocess
import tempfile
import unittest

SRC = Path(__file__).resolve().parents[2] / "native/ge04"
PROGRAM = r"""
#define _POSIX_C_SOURCE 200809L
#include "diagnostic-fd-wait.h"
#include <assert.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <unistd.h>
int main(void) {
    int p[2];
    assert(pipe(p)==0);
    struct ge04_diagnostic_deadline d;
    assert(ge04_deadline_begin(&d, 50000000ULL)==0);
    assert(ge04_diagnostic_wait_fd(&d, p[0], POLLIN)<0);
    assert(d.quarantined); /* blocking descriptor rejected */
    assert(fcntl(p[0], F_SETFL, O_NONBLOCK)==0);
    assert(ge04_deadline_begin(&d, 20000000ULL)==0);
    assert(ge04_diagnostic_wait_fd(&d, p[0], POLLIN)<0);
    assert(errno==ETIMEDOUT && d.quarantined);
    assert(ge04_diagnostic_wait_fd(&d, p[0], POLLIN)<0);
    assert(ge04_deadline_begin(&d, 500000000ULL)==0);
    assert(write(p[1], "a", 1)==1);
    assert(ge04_diagnostic_wait_fd(&d, p[0], POLLIN)==0);
    assert(!d.quarantined);
    assert(!ge04_deadline_can_dispatch(&d));
    assert(!ge04_deadline_can_ack(&d));
    close(p[1]);
    assert(ge04_diagnostic_wait_fd(&d, p[0], POLLIN)<0);
    assert(d.quarantined); /* hangup, even if unread bytes remain */
    close(p[0]);
    assert(ge04_deadline_begin(&d, 100000000ULL)==0);
    assert(ge04_diagnostic_wait_fd(&d, -1, POLLIN)<0);
    assert(d.quarantined);
    return 0;
}
"""


class DiagnosticFdWaitTests(unittest.TestCase):
    def test_readiness_timeout_and_fail_closed(self):
        with tempfile.TemporaryDirectory(prefix="ge04-fd-") as directory:
            path = Path(directory)
            (path / "main.c").write_text(PROGRAM)
            subprocess.run(["cc", "-std=c11", "-Wall", "-Wextra", "-Werror",
                            "-I", str(SRC), str(path / "main.c"),
                            str(SRC / "diagnostic-fd-wait.c"),
                            str(SRC / "diagnostic-deadline.c"),
                            "-o", str(path / "main")], check=True, timeout=20)
            subprocess.run([str(path / "main")], check=True, timeout=5)

    def test_no_dispatch_symbols(self):
        code = (SRC / "diagnostic-fd-wait.c").read_text()
        for forbidden in ("sd_bus_send(", "sd_bus_call(", "StartTransientUnit",
                          "execve(", "setuid(", "fork("):
            self.assertNotIn(forbidden, code)
