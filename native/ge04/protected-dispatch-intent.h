#ifndef GE04_PROTECTED_DISPATCH_INTENT_H
#define GE04_PROTECTED_DISPATCH_INTENT_H
#include "protected-dispatch-preparation.h"
#include <stddef.h>
#define GE04_DISPATCH_INTENT_FILE "dispatch-intent.v1"
#define GE04_DISPATCH_INTENT_MAX 512

struct ge04_dispatch_intent_custody {
    int directory_fd;
    int intent_fd;
    unsigned long long device;
    unsigned long long inode;
    int owned;
};
/* Non-authorizing exact bytes: original claim, pinned unique owner,
 * exact fixed request identity, and pre-send RECORD-CREATION state.
 * This marker never proves no later send occurred.
 */
int ge04_dispatch_intent_encode(
    const struct ge04_prebirth_claim *claim,
    const char *manager_unique_name,
    char out[GE04_DISPATCH_INTENT_MAX], size_t *length);
void ge04_dispatch_intent_init(struct ge04_dispatch_intent_custody *held);
void ge04_dispatch_intent_close(struct ge04_dispatch_intent_custody *held);
/* Candidate root-only durable O_EXCL prepare-before-send handoff.
 * Requires the exact held attempt/journal and prepared D-Bus message.
 * Existing or partial files permanently quarantine; no retry/recovery.
 * NEVER sends the request. No installed root caller is enabled.
 */
int ge04_dispatch_intent_stage(
    const struct ge04_prebirth_claim *claim,
    const struct ge04_attempt_custody *attempt,
    const struct ge04_journal_custody *journal,
    struct ge04_systemd_transaction *tx,
    const struct ge04_prepared_dispatch *prepared,
    struct ge04_dispatch_intent_custody *held);
int ge04_dispatch_intent_recheck(
    const struct ge04_prebirth_claim *claim,
    const char *manager_unique_name,
    const struct ge04_dispatch_intent_custody *held);
#endif
