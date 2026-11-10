#ifndef GE04_PROTECTED_SYSTEMD_TRANSACTION_H
#define GE04_PROTECTED_SYSTEMD_TRANSACTION_H

#include "protected-attempt-fence.h"
#include "protected-prebirth-journal.h"
#include <systemd/sd-bus.h>

/* Production-intended source candidate; no installed caller or root execution.
 * A subscription is not a successful exclusive StartTransientUnit transaction.
 */
struct ge04_systemd_transaction {
    sd_bus *bus;
    sd_bus_slot *job_slot;
    char owner[64];
    int subscribed;
    int poisoned;
};

void ge04_systemd_transaction_init(struct ge04_systemd_transaction *tx);
void ge04_systemd_transaction_close(struct ge04_systemd_transaction *tx);

/* Require original root descriptor custody, pin root-owned systemd unique
 * sender, install JobRemoved filter and subscribe BEFORE any creation call.
 * On ambiguity, abort and quarantine. No unit creation in this API.
 */
int ge04_systemd_subscribe_original(
    const struct ge04_prebirth_claim *claim,
    const struct ge04_attempt_custody *attempt,
    const struct ge04_journal_custody *journal,
    struct ge04_systemd_transaction *tx);

/* Re-check original custody and manager unique owner while connected. */
int ge04_systemd_recheck_original(
    const struct ge04_prebirth_claim *claim,
    const struct ge04_attempt_custody *attempt,
    const struct ge04_journal_custody *journal,
    struct ge04_systemd_transaction *tx);

/* Intentional security hold: no StartTransientUnit is sent, under any build. */
int ge04_systemd_create_exclusive(struct ge04_systemd_transaction *tx);
#endif
