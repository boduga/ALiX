/* GE-04 Phase 4A3: no-follow mount namespace custody SOURCE CANDIDATE.
 * No setns/unshare/mount operation or worker admission; no root entrypoint.
 */
#define _GNU_SOURCE
#include "protected-mount-namespace.h"
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#define MOUNTINFO_CAP 65536
#define MOUNTINFO_LINE_CAP 4096

static int deny(void) { errno = EPERM; return -1; }
static int root_identity(void) {
    return getuid() == 0 && geteuid() == 0 &&
           getgid() == 0 && getegid() == 0;
}
void ge04_mount_namespace_init(struct ge04_mount_namespace_custody *held) {
    if (!held) return;
    held->keeper_ns_fd = -1;
    held->controller_ns_fd = -1;
    held->ns_device = 0;
    held->ns_inode = 0;
    held->keeper_pid = 0;
    held->keeper_startticks = 0;
    held->cgroup_mount_id = 0;
    held->held = 0;
}
void ge04_mount_namespace_close(struct ge04_mount_namespace_custody *held) {
    if (!held) return;
    if (held->held == 1) {
        if (held->keeper_ns_fd >= 0) close(held->keeper_ns_fd);
        if (held->controller_ns_fd >= 0) close(held->controller_ns_fd);
    }
    ge04_mount_namespace_init(held);
}
/* Strictly decimal u64 without octal, signs, truncation or leading zero.
 * This is an exact mountinfo *field* parser, never an arbitrary path parser.
 */
static int decimal_id(const char *start, size_t len, uint64_t *out) {
    if (!start || !out || !len || len > 20 ||
        (len > 1 && start[0] == '0')) return -1;
    uint64_t id = 0;
    for (size_t i = 0; i < len; ++i) {
        if (start[i] < '0' || start[i] > '9') return -1;
        uint64_t digit = (uint64_t)(start[i] - '0');
        if (id > (UINT64_MAX - digit) / 10) return -1;
        id = id * 10 + digit;
    }
    if (!id) return -1;
    *out = id;
    return 0;
}
/* One exact unescaped fixed mount:
 * ID parent major:minor / /sys/fs/cgroup opts ... - cgroup2 cgroup2 super
 * Reject duplicate fixed mountpoints or suspicious escaped variants.
 * No caller supplies paths. */
static int parse_mountinfo(const char *buf, size_t len, uint64_t required_id) {
    if (!buf || !len || len > MOUNTINFO_CAP || !required_id ||
        buf[len - 1] != '\n') return -1;
    size_t begin = 0;
    int seen = 0;
    while (begin < len) {
        size_t end = begin;
        while (end < len && buf[end] != '\n') ++end;
        if (end >= len || end - begin >= MOUNTINFO_LINE_CAP) return -1;
        const char *fields[6] = {0};
        size_t sizes[6] = {0};
        size_t p = begin;
        for (unsigned k = 0; k < 6; ++k) {
            if (p >= end) return -1;
            size_t start = p;
            while (p < end && buf[p] != ' ') ++p;
            if (p == start) return -1;
            fields[k] = buf + start;
            sizes[k] = p - start;
            if (k < 5) {
                if (p >= end) return -1;
                ++p;
            }
        }
        int matching_point = sizes[4] == strlen("/sys/fs/cgroup") &&
            memcmp(fields[4], "/sys/fs/cgroup", sizes[4]) == 0;
        if (matching_point) {
            if (seen) return -1;
            seen = 1;
            uint64_t id = 0;
            if (decimal_id(fields[0], sizes[0], &id) < 0 ||
                id != required_id || sizes[3] != 1 ||
                fields[3][0] != '/') return -1;
            /* Find the uniquely positioned separator and require fixed
             * filesystem and source tokens immediately after it. */
            size_t separator = p;
            int found = 0;
            while (separator + 3 < end) {
                if (buf[separator] == ' ' &&
                    buf[separator + 1] == '-' &&
                    buf[separator + 2] == ' ') {
                    if (found) return -1;
                    found = 1;
                    size_t fs = separator + 3;
                    static const char kind[] = "cgroup2 cgroup2 ";
                    if (fs + sizeof(kind) - 1 > end ||
                        memcmp(buf + fs, kind, sizeof(kind) - 1) != 0)
                        return -1;
                }
                ++separator;
            }
            if (!found) return -1;
        }
        begin = end + 1;
    }
    return seen == 1 ? 0 : -1;
}
static int mountinfo_matches(pid_t pid, uint64_t mount_id) {
    char path[64];
    int n = snprintf(path, sizeof(path), "/proc/%ld/mountinfo", (long)pid);
    if (n <= 0 || (size_t)n >= sizeof(path)) return -1;
    int fd = open(path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC);
    if (fd < 0) return -1;
    char bytes[MOUNTINFO_CAP];
    size_t size = 0;
    int ok = 1;
    while (size < sizeof(bytes)) {
        ssize_t got = read(fd, bytes + size, sizeof(bytes) - size);
        if (got < 0 && errno == EINTR) continue;
        if (got < 0) { ok = 0; break; }
        if (!got) break;
        size += (size_t)got;
    }
    if (size == sizeof(bytes)) {
        char extra;
        if (read(fd, &extra, 1) != 0) ok = 0;
    }
    close(fd);
    return ok && parse_mountinfo(bytes, size, mount_id) == 0 ? 0 : -1;
}
static int namespace_id(int fd, dev_t *device, ino_t *inode) {
    struct stat st;
    if (fd < 0 || fstat(fd, &st) < 0 || !st.st_dev || !st.st_ino)
        return -1;
    *device = st.st_dev;
    *inode = st.st_ino;
    return 0;
}
static int open_keeper_namespace(pid_t pid) {
    char path[64];
    int n = snprintf(path, sizeof(path), "/proc/%ld/ns/mnt", (long)pid);
    if (n <= 0 || (size_t)n >= sizeof(path)) return -1;
    /* /proc/PID/ns/mnt is intentionally an nsfs magic link. O_NOFOLLOW
     * would reject the legitimate namespace FD; never follow any
     * user-controlled pathname or accept another namespace target. */
    return open(path, O_RDONLY | O_CLOEXEC);
}
int ge04_mount_namespace_recheck_unqualified(
    struct ge04_keeper_custody *keeper,
    struct ge04_cgroup_custody *cgroup,
    struct ge04_mount_namespace_custody *held) {
    if (!root_identity() || !keeper || !cgroup || !held ||
        held->held != 1 || held->keeper_pid != keeper->pid ||
        held->keeper_startticks != keeper->startticks ||
        held->cgroup_mount_id != cgroup->root.mount_id ||
        !held->ns_device || !held->ns_inode ||
        ge04_keeper_recheck_unqualified(keeper) < 0 ||
        ge04_cgroup_recheck_unqualified(keeper, cgroup) < 0)
        return deny();
    int fresh = open_keeper_namespace(keeper->pid);
    if (fresh < 0) return deny();
    dev_t dev = 0, controller_dev = 0, pinned_dev = 0;
    ino_t ino = 0, controller_ino = 0, pinned_ino = 0;
    int ok = namespace_id(fresh, &dev, &ino) == 0 &&
        namespace_id(held->keeper_ns_fd, &pinned_dev, &pinned_ino) == 0 &&
        namespace_id(held->controller_ns_fd, &controller_dev, &controller_ino) == 0 &&
        dev == held->ns_device && ino == held->ns_inode &&
        pinned_dev == dev && pinned_ino == ino &&
        controller_dev == dev && controller_ino == ino &&
        mountinfo_matches(keeper->pid, held->cgroup_mount_id) == 0 &&
        mountinfo_matches(getpid(), held->cgroup_mount_id) == 0;
    close(fresh);
    if (!ok || ge04_keeper_recheck_unqualified(keeper) < 0 ||
        ge04_cgroup_recheck_unqualified(keeper, cgroup) < 0) return deny();
    return 0; /* UNQUALIFIED: matching current mount namespace only. */
}
int ge04_mount_namespace_pin_unqualified(
    struct ge04_keeper_custody *keeper,
    struct ge04_cgroup_custody *cgroup,
    struct ge04_mount_namespace_custody *held) {
    if (!root_identity() || !keeper || !cgroup || !held ||
        held->keeper_ns_fd != -1 || held->controller_ns_fd != -1 ||
        held->held || held->keeper_pid || held->keeper_startticks)
        return deny();
    if (ge04_keeper_recheck_unqualified(keeper) < 0 ||
        ge04_cgroup_recheck_unqualified(keeper, cgroup) < 0)
        return deny();
    struct ge04_mount_namespace_custody candidate;
    ge04_mount_namespace_init(&candidate);
    candidate.keeper_ns_fd = open_keeper_namespace(keeper->pid);
    if (candidate.keeper_ns_fd < 0) return deny();
    candidate.controller_ns_fd = open("/proc/self/ns/mnt", O_RDONLY | O_CLOEXEC);
    if (candidate.controller_ns_fd < 0) goto fail;
    dev_t keeper_dev = 0, controller_dev = 0;
    ino_t keeper_ino = 0, controller_ino = 0;
    if (namespace_id(candidate.keeper_ns_fd, &keeper_dev, &keeper_ino) < 0 ||
        namespace_id(candidate.controller_ns_fd, &controller_dev, &controller_ino) < 0 ||
        keeper_dev != controller_dev || keeper_ino != controller_ino ||
        mountinfo_matches(keeper->pid, cgroup->root.mount_id) < 0 ||
        mountinfo_matches(getpid(), cgroup->root.mount_id) < 0)
        goto fail;
    candidate.ns_device = keeper_dev;
    candidate.ns_inode = keeper_ino;
    candidate.keeper_pid = keeper->pid;
    candidate.keeper_startticks = keeper->startticks;
    candidate.cgroup_mount_id = cgroup->root.mount_id;
    candidate.held = 1;
    if (ge04_keeper_recheck_unqualified(keeper) < 0 ||
        ge04_cgroup_recheck_unqualified(keeper, cgroup) < 0)
        goto fail;
    *held = candidate;
    if (ge04_mount_namespace_recheck_unqualified(keeper, cgroup, held) < 0) {
        ge04_mount_namespace_close(held);
        return deny();
    }
    return 0;
fail:
    if (candidate.controller_ns_fd >= 0) close(candidate.controller_ns_fd);
    if (candidate.keeper_ns_fd >= 0) close(candidate.keeper_ns_fd);
    return deny();
}
