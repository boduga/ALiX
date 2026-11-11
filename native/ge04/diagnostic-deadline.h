#ifndef GE04_DIAGNOSTIC_DEADLINE_H
#define GE04_DIAGNOSTIC_DEADLINE_H
#include <stdint.h>

/* Non-operational lifetime diagnostic; CLOCK_MONOTONIC is sampled locally.
 * No timeout of blocking syscalls, no signal cancellation, no authorization.
 */
struct ge04_diagnostic_deadline {
    uint64_t absolute_ns;
    uint64_t last_ns;
    int quarantined;
};

int ge04_deadline_begin(struct ge04_diagnostic_deadline *d, uint64_t budget_ns);
int ge04_deadline_check(struct ge04_diagnostic_deadline *d);
int ge04_deadline_remaining(struct ge04_diagnostic_deadline *d,
                           uint64_t *remaining_ns);
void ge04_deadline_quarantine(struct ge04_diagnostic_deadline *d);
int ge04_deadline_can_dispatch(const struct ge04_diagnostic_deadline *d);
int ge04_deadline_can_ack(const struct ge04_diagnostic_deadline *d);
#endif
