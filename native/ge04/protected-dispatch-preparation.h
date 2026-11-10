#ifndef GE04_PROTECTED_DISPATCH_PREPARATION_H
#define GE04_PROTECTED_DISPATCH_PREPARATION_H

#include "protected-systemd-transaction.h"

/* Native preparation of one fixed StartTransientUnit message.
 * NO dispatch, no request cookie, no unit birth, and NO ACK.
 * Default controller stays exit 77; all privileged qualification held.
 */
struct ge04_prepared_dispatch {
    sd_bus_message *message;
    int prepared;
};

void ge04_prepared_dispatch_init(struct ge04_prepared_dispatch *out);
void ge04_prepared_dispatch_close(struct ge04_prepared_dispatch *out);

/* Require original attempt/prebirth and pinned manager subscription, build
 * a single fixed method-call payload on that same private system bus.
 * An unsuccessful preparation poisons the transaction. Never sends.
 */
int ge04_prepare_fixed_dispatch(
    const struct ge04_prebirth_claim *claim,
    const struct ge04_attempt_custody *attempt,
    const struct ge04_journal_custody *journal,
    struct ge04_systemd_transaction *tx,
    struct ge04_prepared_dispatch *out);

/* NO-OP SECURITY HOLD: always EPERM, never calls sd_bus_send/call. */
int ge04_dispatch_prepared(
    struct ge04_systemd_transaction *tx,
    struct ge04_prepared_dispatch *out);
#endif
