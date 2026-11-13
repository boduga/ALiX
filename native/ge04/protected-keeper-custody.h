#ifndef GE04_PROTECTED_KEEPER_CUSTODY_H
#define GE04_PROTECTED_KEEPER_CUSTODY_H

#include "protected-systemd-birth-observer.h"
#include <stdint.h>
#include <sys/types.h>

/* Source candidate only: no trusted issuer, new birth or ACK. A pidfd
 * corroborates a process identity; it does not prove original creation.
 */
struct ge04_keeper_custody {
    int pidfd;
    pid_t pid;
    uint64_t startticks;
    char invocation[33];
    int held;
};

void ge04_keeper_custody_init(struct ge04_keeper_custody *held);
void ge04_keeper_custody_close(struct ge04_keeper_custody *held);

/* Requires root, an original journal/attempt on the same held transaction,
 * and a stable but UNQUALIFIED systemd unit view. The caller MUST have
 * independently established authentic new birth; this source does not.
 * On all errors, no keeper authority is returned.
 */
int ge04_keeper_pin_unqualified(
    const struct ge04_prebirth_claim *claim,
    const struct ge04_attempt_custody *attempt,
    const struct ge04_journal_custody *journal,
    struct ge04_systemd_transaction *tx,
    struct ge04_keeper_custody *held);

int ge04_keeper_recheck_unqualified(struct ge04_keeper_custody *held);
#endif
