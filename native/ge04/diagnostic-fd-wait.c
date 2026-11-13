#define _POSIX_C_SOURCE 200809L
#include "diagnostic-fd-wait.h"
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdint.h>
#include <poll.h>

static int fail(struct ge04_diagnostic_deadline *d, int err) {
    ge04_deadline_quarantine(d);
    errno = err;
    return -1;
}
int ge04_diagnostic_wait_fd_cancel(struct ge04_diagnostic_deadline *d,
                                   int fd, short events, int cancel_fd) {
    if (!d || fd < 0 || (events != POLLIN && events != POLLOUT))
        return fail(d, EINVAL);
    int flags = fcntl(fd, F_GETFL);
    if (flags < 0) return fail(d, errno);
    if (!(flags & O_NONBLOCK)) return fail(d, EPERM);
    if (cancel_fd < -1 || cancel_fd == fd) return fail(d, EINVAL);
    if (cancel_fd >= 0) {
        int cf = fcntl(cancel_fd, F_GETFL);
        if (cf < 0) return fail(d, errno);
        if (!(cf & O_NONBLOCK)) return fail(d, EPERM);
    }
    for (;;) {
        uint64_t ns = 0;
        if (ge04_deadline_remaining(d, &ns) < 0) return -1;
        /* Round up; the original absolute budget is checked again after poll.
         * INT_MAX cap prevents overflow and does not reset the deadline.
         */
        uint64_t ms = ns / 1000000ULL + (ns % 1000000ULL != 0);
        int timeout = ms > INT_MAX ? INT_MAX : (int)ms;
        struct pollfd p[2] = {
            {.fd = fd, .events = events, .revents = 0},
            {.fd = cancel_fd, .events = POLLIN, .revents = 0}
        };
        int r = poll(p, cancel_fd >= 0 ? 2 : 1, timeout);
        if (r < 0 && errno == EINTR) continue;
        if (r < 0) return fail(d, errno);
        if (r == 0) continue; /* recheck absolute deadline */
        /* Cancellation takes precedence even if the data fd is also ready. */
        if (cancel_fd >= 0 && p[1].revents) return fail(d, ECANCELED);
        if (p[0].revents & (POLLERR | POLLHUP | POLLNVAL))
            return fail(d, EIO);
        if (!(p[0].revents & events)) return fail(d, EIO);
        if (ge04_deadline_check(d) < 0) return -1;
        /* Nonblocking second probe detects cancellation already pending.
         * This is NOT atomic with return or a subsequent I/O operation. */
        if (cancel_fd >= 0) {
            struct pollfd c = {.fd = cancel_fd, .events = POLLIN};
            int cr = poll(&c, 1, 0);
            if (cr < 0) return fail(d, errno);
            if (cr > 0 && c.revents) return fail(d, ECANCELED);
        }
        return 0; /* readiness only, not completed I/O */
    }
}

int ge04_diagnostic_wait_fd(struct ge04_diagnostic_deadline *d,
                            int fd, short events) {
    return ge04_diagnostic_wait_fd_cancel(d, fd, events, -1);
}
