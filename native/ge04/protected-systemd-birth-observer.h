#ifndef GE04_PROTECTED_SYSTEMD_BIRTH_OBSERVER_H
#define GE04_PROTECTED_SYSTEMD_BIRTH_OBSERVER_H

#include "protected-systemd-transaction.h"
#include <stdint.h>

/* Read-only, still UNQUALIFIED. An observed active unit cannot prove
 * exclusive NEW birth or original keeper/kernel ancestry.
 */
struct ge04_unqualified_birth_view {
    uint32_t main_pid;
    char invocation[33];
    int unqualified;
};

/* Read-only two stable manager snapshots after matching job completion.
 * No production code can issue the prerequisite creation request today.
 * Success never authorizes a worker, ACK, or root transaction.
 */
int ge04_observe_unqualified_postbirth(
    const struct ge04_prebirth_claim *claim,
    const struct ge04_attempt_custody *attempt,
    const struct ge04_journal_custody *journal,
    struct ge04_systemd_transaction *tx,
    struct ge04_unqualified_birth_view *view);
#endif
