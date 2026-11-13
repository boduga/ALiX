#ifndef GE04_PROTECTED_ATTEMPT_FENCE_H
#define GE04_PROTECTED_ATTEMPT_FENCE_H

#include "protected-prebirth-journal.h"

/* One-shot native attempt. NO recovery, rollover or automatic retry.
 * This source is review-only and is not reached by a privileged entrypoint.
 */
#define GE04_ATTEMPT_FILE "attempt-fence.v1"
#define GE04_ATTEMPT_MAX 320

struct ge04_attempt_custody {
    int directory_fd;
    int fence_fd;
    unsigned long long device;
    unsigned long long inode;
    int owned;
};

/* Canonical first-attempt record; checks source/controller hash binding.
 * This formatting function is non-authorizing and safe for unprivileged tests.
 */
int ge04_attempt_fence_encode(const struct ge04_prebirth_claim *claim,
                              char out[GE04_ATTEMPT_MAX], size_t *length);

/* Read the actual kernel boot UUID and normalize to 32 lowercase hex.
 * This read-only function cannot attest kernel origin to remote clients.
 */
int ge04_read_kernel_boot_id(char boot_id[33]);

void ge04_attempt_custody_init(struct ge04_attempt_custody *held);
void ge04_attempt_close(struct ge04_attempt_custody *held);

/* Root-only exclusive FIRST attempt. Builds claim fields boot/nonce/attempt
 * from the kernel, persistently fences it before prebirth staging, and
 * holds original FDs; caller fills source/controller hashes separately.
 * Any existing record (even corrupt or previous boot) means permanent
 * refusal until a different independently reviewed recovery design.
 */
int ge04_attempt_begin(struct ge04_prebirth_claim *claim,
                       struct ge04_attempt_custody *held);
int ge04_attempt_recheck(const struct ge04_prebirth_claim *claim,
                         const struct ge04_attempt_custody *held);
#endif
