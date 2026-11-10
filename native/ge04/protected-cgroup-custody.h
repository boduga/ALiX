#ifndef GE04_PROTECTED_CGROUP_CUSTODY_H
#define GE04_PROTECTED_CGROUP_CUSTODY_H

#include "protected-keeper-custody.h"
#include <stdint.h>
#include <sys/types.h>

/* Fixed no-follow cgroup2 descriptor chain. Candidate source only.
 * Stable current directories do not prove original unit birth or ancestry.
 */
struct ge04_cgroup_identity {
    dev_t device;
    ino_t inode;
    uint64_t mount_id;
};
struct ge04_cgroup_custody {
    int root_fd;
    int slice_fd;
    int unit_fd;
    struct ge04_cgroup_identity root, slice, unit;
    pid_t keeper_pid;
    uint64_t keeper_startticks;
    int held;
};

void ge04_cgroup_custody_init(struct ge04_cgroup_custody *held);
void ge04_cgroup_custody_close(struct ge04_cgroup_custody *held);

/* The verified keeper handle is consumed only as identity evidence; its
 * pidfd remains owned by the calling keeper custody object. No adoption.
 * Requires root and an original held journal/transaction. The source
 * cannot be reached through the disabled controller entrypoint.
 */
int ge04_cgroup_pin_unqualified(
    const struct ge04_prebirth_claim *claim,
    const struct ge04_attempt_custody *attempt,
    const struct ge04_journal_custody *journal,
    struct ge04_systemd_transaction *tx,
    struct ge04_keeper_custody *keeper,
    struct ge04_cgroup_custody *held);

int ge04_cgroup_recheck_unqualified(
    struct ge04_keeper_custody *keeper,
    struct ge04_cgroup_custody *held);
#endif
