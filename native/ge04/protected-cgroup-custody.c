/* GE-04 Phase 4A2: native cgroup2 descriptor custody SOURCE CANDIDATE.
 * Read-only. No cgroup creation, controller write, worker admission or ACK.
 * Current unit existence does NOT establish original unit-birth custody.
 */
#define _GNU_SOURCE
#include "protected-cgroup-custody.h"
#include "protected-prebirth-journal.h"
#include <errno.h>
#include <fcntl.h>
#include <linux/magic.h>
#include <linux/stat.h>
#include <stdint.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/vfs.h>
#include <unistd.h>

static int refuse(void) { errno = EPERM; return -1; }
static int root_identity(void) {
    return getuid() == 0 && geteuid() == 0 &&
           getgid() == 0 && getegid() == 0;
}
void ge04_cgroup_custody_init(struct ge04_cgroup_custody *held) {
    if (!held) return;
    held->root_fd = -1;
    held->slice_fd = -1;
    held->unit_fd = -1;
    memset(&held->root, 0, sizeof(held->root));
    memset(&held->slice, 0, sizeof(held->slice));
    memset(&held->unit, 0, sizeof(held->unit));
    held->keeper_pid = 0;
    held->keeper_startticks = 0;
    held->held = 0;
}
void ge04_cgroup_custody_close(struct ge04_cgroup_custody *held) {
    if (!held) return;
    if (held->held == 1) {
        if (held->unit_fd >= 0) close(held->unit_fd);
        if (held->slice_fd >= 0) close(held->slice_fd);
        if (held->root_fd >= 0) close(held->root_fd);
    }
    ge04_cgroup_custody_init(held);
}

/* Verify the *descriptor*, not merely its pathname. Reject kernels which
 * cannot supply a mount ID. Same mount ID and device are required for all
 * three directories, avoiding crossing a bind mount between components.
 */
static int snapshot(int fd, struct ge04_cgroup_identity *identity) {
    if (fd < 0 || !identity) return -1;
    struct stat st;
    struct statfs fs;
    struct statx sx;
    memset(&sx, 0, sizeof(sx));
    if (fstat(fd, &st) < 0 || fstatfs(fd, &fs) < 0 ||
        !S_ISDIR(st.st_mode) || fs.f_type != CGROUP2_SUPER_MAGIC ||
        st.st_uid != 0 || st.st_gid != 0 ||
        (st.st_mode & 0022) || !st.st_ino || !st.st_dev ||
        statx(fd, "", AT_EMPTY_PATH | AT_SYMLINK_NOFOLLOW,
              STATX_MNT_ID | STATX_INO | STATX_TYPE, &sx) < 0 ||
        (sx.stx_mask & (STATX_MNT_ID | STATX_INO | STATX_TYPE)) !=
            (STATX_MNT_ID | STATX_INO | STATX_TYPE) ||
        !sx.stx_mnt_id || sx.stx_ino != (uint64_t)st.st_ino ||
        (sx.stx_mode & S_IFMT) != S_IFDIR)
        return -1;
    identity->device = st.st_dev;
    identity->inode = st.st_ino;
    identity->mount_id = sx.stx_mnt_id;
    return 0;
}
static int same(const struct ge04_cgroup_identity *a,
                const struct ge04_cgroup_identity *b) {
    return a->device == b->device &&
           a->inode == b->inode &&
           a->mount_id == b->mount_id;
}
static int name_binds(int parent, const char *name, int pinned) {
    struct stat st, target;
    if (fstatat(parent, name, &st, AT_SYMLINK_NOFOLLOW) < 0 ||
        fstat(pinned, &target) < 0 || !S_ISDIR(st.st_mode))
        return -1;
    return st.st_dev == target.st_dev && st.st_ino == target.st_ino ? 0 : -1;
}
static int fixed_root_open(void);
static int revalidate_chain(struct ge04_cgroup_custody *held) {
    struct ge04_cgroup_identity root, slice, unit;
    int current_fd = fixed_root_open();
    if (current_fd < 0) return -1;
    struct ge04_cgroup_identity current;
    int same_root = snapshot(current_fd, &current) == 0 &&
        same(&current, &held->root);
    close(current_fd);
    if (!same_root || snapshot(held->root_fd, &root) < 0 ||
        snapshot(held->slice_fd, &slice) < 0 ||
        snapshot(held->unit_fd, &unit) < 0 ||
        !same(&root, &held->root) ||
        !same(&slice, &held->slice) ||
        !same(&unit, &held->unit) ||
        root.mount_id != slice.mount_id ||
        root.mount_id != unit.mount_id ||
        root.device != slice.device ||
        root.device != unit.device ||
        root.inode == slice.inode ||
        slice.inode == unit.inode ||
        root.inode == unit.inode ||
        name_binds(held->root_fd, "system.slice", held->slice_fd) < 0 ||
        name_binds(held->slice_fd, GE04_PREBIRTH_UNIT, held->unit_fd) < 0)
        return -1;
    return 0;
}
static int fixed_root_open(void) {
    const int flags = O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC;
    int slash = open("/", flags);
    if (slash < 0) return -1;
    int sys = openat(slash, "sys", flags);
    close(slash);
    if (sys < 0) return -1;
    int fs = openat(sys, "fs", flags);
    close(sys);
    if (fs < 0) return -1;
    int root = openat(fs, "cgroup", flags);
    close(fs);
    return root;
}

int ge04_cgroup_recheck_unqualified(
    struct ge04_keeper_custody *keeper,
    struct ge04_cgroup_custody *held) {
    if (!root_identity() || !keeper || !held || held->held != 1 ||
        held->keeper_pid < 2 || held->keeper_startticks == 0 ||
        keeper->pid != held->keeper_pid ||
        keeper->startticks != held->keeper_startticks ||
        ge04_keeper_recheck_unqualified(keeper) < 0 ||
        revalidate_chain(held) < 0 ||
        ge04_keeper_recheck_unqualified(keeper) < 0)
        return refuse();
    return 0; /* Still UNQUALIFIED: neither birth nor original FD provenance. */
}

int ge04_cgroup_pin_unqualified(
    const struct ge04_prebirth_claim *claim,
    const struct ge04_attempt_custody *attempt,
    const struct ge04_journal_custody *journal,
    struct ge04_systemd_transaction *tx,
    struct ge04_keeper_custody *keeper,
    struct ge04_cgroup_custody *held) {
    if (!root_identity() || !claim || !attempt || !journal ||
        !tx || !keeper || !held) return refuse();
    if (held->held || held->root_fd != -1 || held->slice_fd != -1 ||
        held->unit_fd != -1 || held->keeper_pid || held->keeper_startticks)
        return refuse();
    if (ge04_keeper_recheck_unqualified(keeper) < 0 ||
        ge04_systemd_recheck_original(claim, attempt, journal, tx) < 0)
        return refuse();

    struct ge04_cgroup_custody candidate;
    ge04_cgroup_custody_init(&candidate);
    candidate.root_fd = fixed_root_open();
    if (candidate.root_fd < 0) return refuse();
    const int flags = O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC;
    candidate.slice_fd = openat(candidate.root_fd, "system.slice", flags);
    if (candidate.slice_fd < 0) goto failed;
    candidate.unit_fd = openat(candidate.slice_fd, GE04_PREBIRTH_UNIT, flags);
    if (candidate.unit_fd < 0) goto failed;
    if (snapshot(candidate.root_fd, &candidate.root) < 0 ||
        snapshot(candidate.slice_fd, &candidate.slice) < 0 ||
        snapshot(candidate.unit_fd, &candidate.unit) < 0)
        goto failed;
    candidate.keeper_pid = keeper->pid;
    candidate.keeper_startticks = keeper->startticks;
    candidate.held = 1;
    if (revalidate_chain(&candidate) < 0 ||
        ge04_keeper_recheck_unqualified(keeper) < 0 ||
        ge04_systemd_recheck_original(claim, attempt, journal, tx) < 0)
        goto failed;
    *held = candidate;
    if (ge04_cgroup_recheck_unqualified(keeper, held) < 0) {
        ge04_cgroup_custody_close(held);
        return refuse();
    }
    return 0; /* Not proof of original cgroup birth or trusted mount owner. */
failed:
    if (candidate.unit_fd >= 0) close(candidate.unit_fd);
    if (candidate.slice_fd >= 0) close(candidate.slice_fd);
    if (candidate.root_fd >= 0) close(candidate.root_fd);
    return refuse();
}
