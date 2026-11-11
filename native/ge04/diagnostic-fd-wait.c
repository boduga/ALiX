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
int ge04_diagnostic_wait_fd(struct ge04_diagnostic_deadline *d,
                            int fd, short events) {
    if (!d || fd < 0 || (events != POLLIN && events != POLLOUT))
        return fail(d, EINVAL);
    int flags = fcntl(fd, F_GETFL);
    if (flags < 0) return fail(d, errno);
    if (!(flags & O_NONBLOCK)) return fail(d, EPERM);
    for (;;) {
        uint64_t ns = 0;
        if (ge04_deadline_remaining(d, &ns) < 0) return -1;
        /* Round up; the original absolute budget is checked again after poll.
         * INT_MAX cap prevents overflow and does not reset the deadline.
         */
        uint64_t ms = ns / 1000000ULL + (ns % 1000000ULL != 0);
        int timeout = ms > INT_MAX ? INT_MAX : (int)ms;
        struct pollfd p = {.fd = fd, .events = events, .revents = 0};
        int r = poll(&p, 1, timeout);
        if (r < 0 && errno == EINTR) continue;
        if (r < 0) return fail(d, errno);
        if (r == 0) continue; /* recheck absolute deadline */
        if (p.revents & (POLLERR | POLLHUP | POLLNVAL))
            return fail(d, EIO);
        if (!(p.revents & events)) return fail(d, EIO);
        if (ge04_deadline_check(d) < 0) return -1;
        return 0; /* readiness only, not completed I/O */
    }
}
