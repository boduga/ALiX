#define _POSIX_C_SOURCE 200809L
#include "diagnostic-deadline.h"
#include <errno.h>
#include <stddef.h>
#include <time.h>
#include <stdint.h>

static int deny(struct ge04_diagnostic_deadline *d, int error) {
    if (d) d->quarantined = 1;
    errno = error;
    return -1;
}
static int monotonic_ns(uint64_t *out) {
    struct timespec ts;
    if (clock_gettime(CLOCK_MONOTONIC, &ts) != 0) return -1;
    if (ts.tv_sec < 0 || ts.tv_nsec < 0 || ts.tv_nsec >= 1000000000L ||
        (uint64_t)ts.tv_sec > (UINT64_MAX - (uint64_t)ts.tv_nsec)/1000000000ULL)
        return -1;
    *out = (uint64_t)ts.tv_sec * 1000000000ULL + (uint64_t)ts.tv_nsec;
    return 0;
}
int ge04_deadline_begin(struct ge04_diagnostic_deadline *d, uint64_t budget_ns) {
    if (!d) { errno = EINVAL; return -1; }
    *d = (struct ge04_diagnostic_deadline){.quarantined=1};
    uint64_t now;
    if (!budget_ns || monotonic_ns(&now) != 0 ||
        budget_ns > UINT64_MAX - now)
        return deny(d, EINVAL);
    d->absolute_ns = now + budget_ns;
    d->last_ns = now;
    d->quarantined = 0;
    return 0;
}
int ge04_deadline_remaining(struct ge04_diagnostic_deadline *d,
                           uint64_t *remaining_ns) {
    if (!d || d->quarantined || !remaining_ns)
        return deny(d, EINVAL);
    uint64_t now;
    if (monotonic_ns(&now) != 0 || now < d->last_ns)
        return deny(d, EIO);
    d->last_ns = now;
    if (now >= d->absolute_ns) return deny(d, ETIMEDOUT);
    *remaining_ns = d->absolute_ns - now;
    return 0;
}
int ge04_deadline_check(struct ge04_diagnostic_deadline *d) {
    uint64_t remaining;
    return ge04_deadline_remaining(d, &remaining);
}
void ge04_deadline_quarantine(struct ge04_diagnostic_deadline *d) {
    if (d) d->quarantined = 1;
}
int ge04_deadline_can_dispatch(const struct ge04_diagnostic_deadline *d) {
    (void)d; return 0;
}
int ge04_deadline_can_ack(const struct ge04_diagnostic_deadline *d) {
    (void)d; return 0;
}
