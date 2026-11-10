#ifndef GE04_PROTECTED_MOUNT_NAMESPACE_H
#define GE04_PROTECTED_MOUNT_NAMESPACE_H
#include "protected-cgroup-custody.h"
#include <stdint.h>
#include <sys/types.h>

/* Native read-only candidate. A matching namespace is corroboration, not
 * proof that root-controller and keeper shared this namespace at birth.
 */
struct ge04_mount_namespace_custody {
    int keeper_ns_fd;
    int controller_ns_fd;
    dev_t ns_device;
    ino_t ns_inode;
    pid_t keeper_pid;
    uint64_t keeper_startticks;
    uint64_t cgroup_mount_id;
    int held;
};
void ge04_mount_namespace_init(struct ge04_mount_namespace_custody *held);
void ge04_mount_namespace_close(struct ge04_mount_namespace_custody *held);

int ge04_mount_namespace_pin_unqualified(
    struct ge04_keeper_custody *keeper,
    struct ge04_cgroup_custody *cgroup,
    struct ge04_mount_namespace_custody *held);

int ge04_mount_namespace_recheck_unqualified(
    struct ge04_keeper_custody *keeper,
    struct ge04_cgroup_custody *cgroup,
    struct ge04_mount_namespace_custody *held);
#endif
