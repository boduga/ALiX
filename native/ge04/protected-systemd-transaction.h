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
    /* Job receipt is permanently unreachable from the held creator.
     * A future reviewed sender must own this transition on the SAME bus.
     */
    int request_in_flight;
    uint64_t request_cookie; /* exact outgoing D-Bus method serial */
    int reply_bound;
    int job_seen;
    int job_done_claimed;
    char job_path[80];
    char early_job_path[80];
    uint32_t early_job_id;
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

/* Bind an authentic systemd method reply on the SAME held bus, only after
 * a future reviewed sender has issued this one request and retained its
 * nonzero D-Bus method cookie. No current source sets these fields. Job done is NOT unit-birth authority.
 */
int ge04_systemd_bind_job_reply(struct ge04_systemd_transaction *tx,
                                sd_bus_message *reply);

/* Intentional security hold: no StartTransientUnit is sent, under any build. */
int ge04_systemd_create_exclusive(struct ge04_systemd_transaction *tx);
#endif
