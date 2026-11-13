/* GE-04 Phase 4A1 native keeper pidfd custody SOURCE CANDIDATE.
 * No new-unit proof, mount/cgroup dirfd ancestry, root entrypoint, or ACK.
 */
#define _GNU_SOURCE
#include "protected-keeper-custody.h"
#include "protected-prebirth-journal.h"
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <unistd.h>

#define PROC_LIMIT 16384
#define CGROUP_LIMIT 256
#define FIXED_CGROUP_LINE "0::/system.slice/" GE04_PREBIRTH_UNIT "\n"

static int denied(void) { errno = EPERM; return -1; }
static int root_identity(void) {
    return getuid() == 0 && geteuid() == 0 &&
           getgid() == 0 && getegid() == 0;
}
void ge04_keeper_custody_init(struct ge04_keeper_custody *held) {
    if (!held) return;
    held->pidfd = -1;
    held->pid = 0;
    held->startticks = 0;
    held->invocation[0] = 0;
    held->held = 0;
}
void ge04_keeper_custody_close(struct ge04_keeper_custody *held) {
    if (!held) return;
    if (held->held == 1 && held->pidfd >= 0) close(held->pidfd);
    ge04_keeper_custody_init(held);
}

/* Exactly bounded procfs reads, checked against pinned regular files. */
static int read_proc(pid_t pid, const char *name, char *out, size_t cap,
                     size_t *length) {
    char path[64];
    int n = snprintf(path, sizeof(path), "/proc/%ld/%s", (long)pid, name);
    if (n <= 0 || (size_t)n >= sizeof(path)) return -1;
    int fd = open(path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC);
    if (fd < 0) return -1;
    struct stat st;
    int ok = fstat(fd, &st) == 0 && S_ISREG(st.st_mode);
    size_t offset = 0;
    while (ok && offset < cap) {
        ssize_t got = read(fd, out + offset, cap - offset);
        if (got < 0 && errno == EINTR) continue;
        if (got <= 0) { if (got < 0) ok = 0; break; }
        offset += (size_t)got;
    }
    if (ok && offset == cap) {
        char extra;
        ssize_t next = read(fd, &extra, 1);
        if (next != 0) ok = 0;
    }
    close(fd);
    if (!ok || !offset || out[offset - 1] != '\n') return -1;
    *length = offset;
    return 0;
}

/* Field 22 is field-index 19 after the closing process name.
 * Never split on the first ')' since the comm string may contain ')'.
 */
static int parse_startticks(const char *raw, size_t length, pid_t pid,
                            uint64_t *ticks) {
    if (!raw || !ticks || !length || length >= PROC_LIMIT) return -1;
    char expected[32];
    int n = snprintf(expected, sizeof(expected), "%ld (", (long)pid);
    if (n <= 0 || (size_t)n >= sizeof(expected) ||
        length < (size_t)n + 24 ||
        memcmp(raw, expected, (size_t)n) != 0) return -1;
    size_t split = 0;
    for (size_t i = (size_t)n; i + 1 < length; ++i)
        if (raw[i] == ')' && raw[i + 1] == ' ') split = i + 2;
    if (!split || split + 2 >= length) return -1;
    if (!strchr("RSDT", raw[split]) || raw[split + 1] != ' ') return -1;
    size_t field = 0;
    size_t start = split;
    for (size_t i = split; i < length; ++i) {
        if (raw[i] != ' ' && raw[i] != '\n') continue;
        if (i == start) return -1;
        if (field == 19) {
            uint64_t value = 0;
            for (size_t j = start; j < i; ++j) {
                if (raw[j] < '0' || raw[j] > '9') return -1;
                uint64_t digit = (uint64_t)(raw[j] - '0');
                if (value > (UINT64_MAX - digit) / 10) return -1;
                value = value * 10 + digit;
            }
            if (!value) return -1;
            *ticks = value;
            return 0;
        }
        field++;
        start = i + 1;
    }
    return -1;
}

static int sample(pid_t pid, uint64_t *ticks) {
    char statbuf[PROC_LIMIT];
    size_t len;
    if (read_proc(pid, "stat", statbuf, sizeof(statbuf), &len) < 0 ||
        parse_startticks(statbuf, len, pid, ticks) < 0) return -1;
    char cgroup[CGROUP_LIMIT];
    if (read_proc(pid, "cgroup", cgroup, sizeof(cgroup), &len) < 0 ||
        len != sizeof(FIXED_CGROUP_LINE) - 1 ||
        memcmp(cgroup, FIXED_CGROUP_LINE, len) != 0)
        return -1;
    return 0;
}

static int alive(int fd) {
    struct pollfd p = { .fd = fd, .events = POLLIN | POLLHUP | POLLERR };
    int r = poll(&p, 1, 0);
    return r == 0 ? 0 : -1;
}

int ge04_keeper_recheck_unqualified(struct ge04_keeper_custody *held) {
    if (!root_identity() || !held || held->held != 1 ||
        held->pidfd < 0 || held->pid < 2 || held->startticks == 0)
        return denied();
    uint64_t current = 0;
    if (alive(held->pidfd) < 0 || sample(held->pid, &current) < 0 ||
        current != held->startticks || alive(held->pidfd) < 0)
        return denied();
    return 0; /* Still NOT original kernel/birth custody. */
}

int ge04_keeper_pin_unqualified(
    const struct ge04_prebirth_claim *claim,
    const struct ge04_attempt_custody *attempt,
    const struct ge04_journal_custody *journal,
    struct ge04_systemd_transaction *tx,
    struct ge04_keeper_custody *held) {
    if (!root_identity() || !claim || !attempt || !journal ||
        !tx || !held) return denied();
    if (held->pidfd != -1 || held->held || held->pid ||
        held->startticks || held->invocation[0]) return denied();
    struct ge04_unqualified_birth_view view = {0};
    if (ge04_observe_unqualified_postbirth(
            claim, attempt, journal, tx, &view) < 0 ||
        !view.unqualified || view.main_pid < 2)
        return denied();
    uint64_t first = 0, second = 0;
    if (sample((pid_t)view.main_pid, &first) < 0) return denied();
#ifdef SYS_pidfd_open
    int fd = (int)syscall(SYS_pidfd_open, (pid_t)view.main_pid, 0u);
#else
    int fd = -1;
    errno = ENOSYS;
#endif
    if (fd < 0) return denied();
    int valid = alive(fd) == 0 &&
        sample((pid_t)view.main_pid, &second) == 0 &&
        first == second && alive(fd) == 0 &&
        ge04_systemd_recheck_original(claim, attempt, journal, tx) == 0;
    if (!valid) { close(fd); return denied(); }
    held->pidfd = fd;
    held->pid = (pid_t)view.main_pid;
    held->startticks = first;
    memcpy(held->invocation, view.invocation, sizeof(held->invocation));
    held->held = 1;
    if (ge04_keeper_recheck_unqualified(held) < 0) {
        ge04_keeper_custody_close(held);
        return denied();
    }
    return 0; /* Unqualified observation, NOT admission. */
}
