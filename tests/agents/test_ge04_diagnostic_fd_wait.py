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

ADVERSARIAL_PROGRAM = r"""
#define _POSIX_C_SOURCE 200809L
#include "diagnostic-fd-wait.h"
#include <assert.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <sys/time.h>
#include <time.h>
#include <unistd.h>

static volatile sig_atomic_t interrupts;
static void on_alarm(int signo) { (void)signo; ++interrupts; }
static uint64_t now_ns(void) {
    struct timespec ts;
    assert(clock_gettime(CLOCK_MONOTONIC, &ts)==0);
    return (uint64_t)ts.tv_sec*1000000000ULL + (uint64_t)ts.tv_nsec;
}
int main(void) {
    int p[2]; assert(pipe(p)==0);
    assert(fcntl(p[0], F_SETFL, O_NONBLOCK)==0);
    struct sigaction sa = {.sa_handler=on_alarm};
    sigemptyset(&sa.sa_mask);
    assert(sigaction(SIGALRM, &sa, 0)==0);
    struct itimerval timer = { .it_interval={0,1000}, .it_value={0,1000} };
    assert(setitimer(ITIMER_REAL, &timer, 0)==0);
    struct ge04_diagnostic_deadline d;
    assert(ge04_deadline_begin(&d, 50000000ULL)==0);
    uint64_t start = now_ns();
    assert(ge04_diagnostic_wait_fd(&d,p[0],POLLIN)==-1);
    uint64_t elapsed = now_ns()-start;
    timer.it_interval.tv_usec=0; timer.it_value.tv_usec=0;
    assert(setitimer(ITIMER_REAL, &timer, 0)==0);
    assert(interrupts>0 && d.quarantined && errno==ETIMEDOUT);
    assert(elapsed < 500000000ULL); /* original 50ms, not per-interrupt reset */
    /* A nonblocking empty pipe read returns EAGAIN; readiness is not I/O. */
    char byte;
    assert(read(p[0],&byte,1)==-1 && errno==EAGAIN);
    assert(ge04_deadline_begin(&d, 100000000ULL)==0);
    assert(ge04_diagnostic_wait_fd(&d,p[0],POLLIN)==-1);
    assert(d.quarantined && errno==ETIMEDOUT);
    /* Reuse numeric descriptor: primitive cannot authenticate fd identity. */
    int old=p[0]; close(p[0]); close(p[1]);
    int q[2]; assert(pipe(q)==0);
    assert(dup2(q[0],old)==old || q[0]==old);
    if (q[0]!=old) close(q[0]);
    assert(fcntl(old,F_SETFL,O_NONBLOCK)==0);
    assert(write(q[1],"x",1)==1);
    assert(ge04_deadline_begin(&d, 100000000ULL)==0);
    assert(ge04_diagnostic_wait_fd(&d,old,POLLIN)==0);
    /* This demonstrates the identity gap: caller must hold original fd custody. */
    close(old); close(q[1]);
    return 0;
}
"""

def _compile_and_run(program):
    with tempfile.TemporaryDirectory(prefix="ge04-adversarial-") as directory:
        path = Path(directory)
        (path / "main.c").write_text(program)
        subprocess.run(["cc", "-std=c11", "-Wall", "-Wextra", "-Werror",
                        "-I", str(SRC), str(path / "main.c"),
                        str(SRC / "diagnostic-fd-wait.c"),
                        str(SRC / "diagnostic-deadline.c"),
                        "-o", str(path / "main")], check=True, timeout=20)
        subprocess.run([str(path / "main")], check=True, timeout=5)


class DiagnosticFdAdversarialTests(unittest.TestCase):
    def test_eintr_eagain_and_fd_reuse_gap(self):
        _compile_and_run(ADVERSARIAL_PROGRAM)

    def test_atomic_cancellation_gap_explicit(self):
        header = (SRC / "diagnostic-fd-wait.h").read_text()
        self.assertIn("ge04_diagnostic_wait_fd_cancel", header)
        self.assertIn("never performs I/O", header)

CANCEL_PROGRAM = r"""
#define _POSIX_C_SOURCE 200809L
#include "diagnostic-fd-wait.h"
#include <assert.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <sys/wait.h>
#include <unistd.h>
static void nonblock(int fd) {
    int flags=fcntl(fd,F_GETFL); assert(flags>=0);
    assert(fcntl(fd,F_SETFL,flags|O_NONBLOCK)==0);
}
int main(void) {
    int data[2], cancel[2];
    assert(pipe(data)==0 && pipe(cancel)==0);
    nonblock(data[0]); nonblock(cancel[0]);
    struct ge04_diagnostic_deadline d;
    assert(ge04_deadline_begin(&d, 200000000ULL)==0);
    assert(write(data[1],"a",1)==1 && write(cancel[1],"x",1)==1);
    assert(ge04_diagnostic_wait_fd_cancel(&d,data[0],POLLIN,cancel[0])==-1);
    assert(errno==ECANCELED && d.quarantined); /* simultaneous readiness */
    assert(ge04_deadline_begin(&d, 200000000ULL)==0);
    char byte;
    assert(read(data[0],&byte,1)==1);
    assert(read(cancel[0],&byte,1)==1);
    pid_t child=fork(); assert(child>=0);
    if (child==0) { /* no privilege or network */
        assert(write(cancel[1],"x",1)==1); _exit(0);
    }
    assert(ge04_diagnostic_wait_fd_cancel(&d,data[0],POLLIN,cancel[0])==-1);
    assert(errno==ECANCELED && d.quarantined);
    int status; assert(waitpid(child,&status,0)==child);
    assert(WIFEXITED(status) && WEXITSTATUS(status)==0);
    assert(ge04_deadline_begin(&d, 100000000ULL)==0);
    assert(ge04_diagnostic_wait_fd_cancel(&d,data[0],POLLIN,data[0])==-1);
    assert(errno==EINVAL && d.quarantined);
    close(cancel[1]); close(cancel[0]); close(data[1]); close(data[0]);
    return 0;
}
"""

class DiagnosticCancellationTests(unittest.TestCase):
    def test_cancel_precedence_and_wakeup(self):
        _compile_and_run(CANCEL_PROGRAM)
