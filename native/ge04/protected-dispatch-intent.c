/* GE-04 Phase 3B4B: original pre-send dispatch intent custody source.
 * This is deliberately a separate O_EXCL RECORD from original prebirth.
 * Intent persists without recovery even after crash before any send.
 * NO systemd call or send, no privileged entrypoint or ACK.
 */
#define _GNU_SOURCE
#include "protected-dispatch-intent.h"
#include "protected-prebirth-journal.h"
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#define MANAGER_PATH "/org/freedesktop/systemd1"
#define MANAGER_IFACE "org.freedesktop.systemd1.Manager"
#define FIXED_SIGNATURE "ssa(sv)a(sa(sv))"
static int refuse(int error) { errno = error; return -1; }
static int root_identity(void) {
    return getuid() == 0 && geteuid() == 0 &&
           getgid() == 0 && getegid() == 0;
}
static int manager_name(const char *owner) {
    if (!owner || owner[0] != ':') return 0;
    size_t i = 1;
    if (owner[i] < '0' || owner[i] > '9') return 0;
    while (owner[i] >= '0' && owner[i] <= '9') ++i;
    if (owner[i++] != '.') return 0;
    if (owner[i] < '0' || owner[i] > '9') return 0;
    while (owner[i] >= '0' && owner[i] <= '9') ++i;
    return owner[i] == 0 && i < 64;
}
int ge04_dispatch_intent_encode(
    const struct ge04_prebirth_claim *claim,
    const char *manager_unique_name,
    char out[GE04_DISPATCH_INTENT_MAX], size_t *length) {
    if (!claim || !out || !length || !manager_name(manager_unique_name))
        return refuse(EINVAL);
    char original[GE04_PREBIRTH_MAX];
    size_t original_size;
    if (claim->attempt != 1 ||
        ge04_prebirth_encode(claim, original, &original_size) < 0)
        return refuse(EINVAL);
    (void)original_size;
    int n = snprintf(out, GE04_DISPATCH_INTENT_MAX,
        "GE04DI1 %s %s %s %s %s 1 %s fail PRE_SEND_INTENT\n",
        claim->boot_id, claim->nonce,
        claim->source_sha256, claim->controller_sha256,
        manager_unique_name, GE04_PREBIRTH_UNIT);
    if (n <= 0 || n >= GE04_DISPATCH_INTENT_MAX)
        return refuse(EOVERFLOW);
    *length = (size_t)n;
    return 0;
}
void ge04_dispatch_intent_init(struct ge04_dispatch_intent_custody *held) {
    if (!held) return;
    held->directory_fd = -1;
    held->intent_fd = -1;
    held->device = 0;
    held->inode = 0;
    held->owned = 0;
}
void ge04_dispatch_intent_close(struct ge04_dispatch_intent_custody *held) {
    if (!held) return;
    if (held->owned == 1) {
        if (held->intent_fd >= 0) close(held->intent_fd);
        if (held->directory_fd >= 0) close(held->directory_fd);
    }
    ge04_dispatch_intent_init(held);
}
int ge04_dispatch_intent_recheck(
    const struct ge04_prebirth_claim *claim,
    const char *owner,
    const struct ge04_dispatch_intent_custody *held) {
    if (!root_identity() || !held || held->owned != 1 ||
        held->directory_fd < 0 || held->intent_fd < 0)
        return refuse(EPERM);
    char bytes[GE04_DISPATCH_INTENT_MAX];
    size_t length;
    if (ge04_dispatch_intent_encode(claim, owner, bytes, &length) < 0)
        return refuse(EPERM);
    struct stat dir, descriptor, named;
    if (fstat(held->directory_fd, &dir) < 0 ||
        !S_ISDIR(dir.st_mode) || dir.st_uid || dir.st_gid ||
        (dir.st_mode & 07777) != 0700 ||
        fstat(held->intent_fd, &descriptor) < 0 ||
        !S_ISREG(descriptor.st_mode) || descriptor.st_uid ||
        descriptor.st_gid || descriptor.st_nlink != 1 ||
        (descriptor.st_mode & 07777) != 0600 ||
        descriptor.st_size != (off_t)length ||
        (unsigned long long)descriptor.st_dev != held->device ||
        (unsigned long long)descriptor.st_ino != held->inode ||
        fstatat(held->directory_fd, GE04_DISPATCH_INTENT_FILE,
                &named, AT_SYMLINK_NOFOLLOW) < 0 ||
        !S_ISREG(named.st_mode) ||
        named.st_dev != descriptor.st_dev ||
        named.st_ino != descriptor.st_ino)
        return refuse(EPERM);
    char observed[GE04_DISPATCH_INTENT_MAX];
    size_t count = 0;
    while (count < length) {
        ssize_t got = pread(held->intent_fd, observed + count,
                            length - count, (off_t)count);
        if (got < 0 && errno == EINTR) continue;
        if (got <= 0) return refuse(EIO);
        count += (size_t)got;
    }
    char excess;
    if (pread(held->intent_fd, &excess, 1, (off_t)length) != 0 ||
        memcmp(bytes, observed, length) != 0)
        return refuse(EIO);
    return 0;
}
static int matches_prepared(
    const struct ge04_systemd_transaction *tx,
    const struct ge04_prepared_dispatch *prepared) {
    if (!prepared || !prepared->prepared || !prepared->message ||
        !tx->bus || !manager_name(tx->owner)) return 0;
    sd_bus_message *m = prepared->message;
    const char *dest = sd_bus_message_get_destination(m);
    const char *path = sd_bus_message_get_path(m);
    const char *iface = sd_bus_message_get_interface(m);
    const char *member = sd_bus_message_get_member(m);
    return sd_bus_message_get_bus(m) == tx->bus &&
        dest && strcmp(dest, tx->owner) == 0 &&
        path && strcmp(path, MANAGER_PATH) == 0 &&
        iface && strcmp(iface, MANAGER_IFACE) == 0 &&
        member && strcmp(member, "StartTransientUnit") == 0 &&
        sd_bus_message_has_signature(m, FIXED_SIGNATURE) == 1;
}
int ge04_dispatch_intent_stage(
    const struct ge04_prebirth_claim *claim,
    const struct ge04_attempt_custody *attempt,
    const struct ge04_journal_custody *journal,
    struct ge04_systemd_transaction *tx,
    const struct ge04_prepared_dispatch *prepared,
    struct ge04_dispatch_intent_custody *held) {
    if (!root_identity() || !claim || !attempt || !journal || !tx ||
        !held || held->owned || held->directory_fd != -1 ||
        held->intent_fd != -1 || held->device || held->inode ||
        tx->poisoned || !tx->subscribed || !tx->job_slot ||
        tx->request_in_flight || tx->request_cookie || tx->reply_bound ||
        tx->job_seen || tx->job_done_claimed ||
        !matches_prepared(tx, prepared)) goto reject;
    if (ge04_attempt_recheck(claim, attempt) < 0 ||
        ge04_prebirth_recheck(claim, journal) < 0 ||
        ge04_systemd_recheck_original(claim, attempt, journal, tx) < 0)
        goto reject;
    char text[GE04_DISPATCH_INTENT_MAX];
    size_t length;
    if (ge04_dispatch_intent_encode(claim, tx->owner, text, &length) < 0)
        goto reject;
    int directory = ge04_open_protected_directory();
    if (directory < 0) goto reject;
    int file = openat(directory, GE04_DISPATCH_INTENT_FILE,
                      O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW |
                      O_NONBLOCK | O_CLOEXEC, 0600);
    if (file < 0) { close(directory); goto reject; }
    /* From this point, ANY error leaves an uncertain permanent marker.
     * Never unlink/rewrite it or retry using the current attempt.
     */
    struct stat info;
    int success = 0;
    if (fstat(file, &info) == 0 && S_ISREG(info.st_mode) &&
        info.st_uid == 0 && info.st_gid == 0 && info.st_nlink == 1 &&
        (info.st_mode & 07777) == 0600) {
        size_t written = 0;
        while (written < length) {
            ssize_t n = write(file, text + written, length - written);
            if (n < 0 && errno == EINTR) continue;
            if (n <= 0) break;
            written += (size_t)n;
        }
        if (written == length && fsync(file) == 0 &&
            fsync(directory) == 0) {
            held->directory_fd = directory;
            held->intent_fd = file;
            held->device = (unsigned long long)info.st_dev;
            held->inode = (unsigned long long)info.st_ino;
            held->owned = 1;
            if (ge04_dispatch_intent_recheck(claim, tx->owner, held) == 0 &&
                ge04_systemd_recheck_original(claim, attempt, journal, tx) == 0 &&
                matches_prepared(tx, prepared))
                success = 1;
            if (!success) ge04_dispatch_intent_init(held);
        }
    }
    if (success) return 0; /* Record prepared, NOT sent. */
    close(file);
    close(directory);
reject:
    if (tx) tx->poisoned = 1;
    return refuse(EPERM);
}
