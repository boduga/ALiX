/* GE-04 protected root controller — Stage 1 custody primitive.
 *
 * REVIEW REQUIRED. NO PRIVILEGED ENTRYPOINT OR LINKED CONTROLLER.
 * This library is production-intended source for independent review only.
 * The fixture/helper's default security hold remains unchanged.
 *
 * Never create the parent directory, adopt existing files, clean up a
 * partial journal, or infer approval/ACK/unit authority from persistence.
 */
#define _GNU_SOURCE
#include "protected-prebirth-journal.h"

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

static int refuse(int reason) {
    errno = reason;
    return -1;
}

static int exact_hex(const char *value, size_t count) {
    if (!value || strnlen(value, count + 1) != count) return 0;
    for (size_t i = 0; i < count; ++i) {
        if (!((value[i] >= '0' && value[i] <= '9') ||
              (value[i] >= 'a' && value[i] <= 'f'))) return 0;
    }
    return 1;
}

int ge04_prebirth_encode(const struct ge04_prebirth_claim *claim,
                         char out[GE04_PREBIRTH_MAX], size_t *length) {
    if (!claim || !out || !length || claim->attempt == 0 ||
        claim->attempt >= (UINT64_C(1) << 63) ||
        !exact_hex(claim->boot_id, 32) ||
        !exact_hex(claim->nonce, 64) ||
        !exact_hex(claim->source_sha256, 64) ||
        !exact_hex(claim->controller_sha256, 64))
        return refuse(EINVAL);

    /* Exactly the sorted-key, compact ASCII canonical_prebirth JSON. */
    int n = snprintf(out, GE04_PREBIRTH_MAX,
       "{\"attempt\":%llu,\"bootId\":\"%s\","
       "\"controllerSha256\":\"%s\",\"expectedAbsent\":true,"
       "\"nonce\":\"%s\",\"schemaVersion\":1,"
       "\"sourceSha256\":\"%s\",\"unit\":\"%s\"}\n",
       (unsigned long long)claim->attempt, claim->boot_id,
       claim->controller_sha256, claim->nonce, claim->source_sha256,
       GE04_PREBIRTH_UNIT);
    if (n <= 0 || n >= GE04_PREBIRTH_MAX) return refuse(EOVERFLOW);
    *length = (size_t)n;
    return 0;
}

static int root_private_dir(int fd, mode_t expected) {
    struct stat s;
    if (fd < 0 || fstat(fd, &s) != 0 || !S_ISDIR(s.st_mode) ||
        s.st_uid != 0 || s.st_gid != 0 ||
        (s.st_mode & 07777) != expected)
        return refuse(EPERM);
    return 0;
}

static int root_parent_dir(int fd) {
    struct stat s;
    if (fd < 0 || fstat(fd, &s) != 0 || !S_ISDIR(s.st_mode) ||
        s.st_uid != 0 || s.st_gid != 0 ||
        (s.st_mode & 0022) != 0)
        return refuse(EPERM);
    return 0;
}

static int original_file(int fd, struct stat *result) {
    if (fd < 0 || fstat(fd, result) != 0 ||
        !S_ISREG(result->st_mode) ||
        result->st_uid != 0 || result->st_gid != 0 ||
        result->st_nlink != 1 || (result->st_mode & 07777) != 0600 ||
        result->st_size <= 0 || result->st_size > GE04_PREBIRTH_MAX)
        return refuse(EPERM);
    return 0;
}

static void reset_custody(struct ge04_journal_custody *custody) {
    custody->directory_fd = -1;
    custody->journal_fd = -1;
    custody->device = 0;
    custody->inode = 0;
    custody->owned = 0;
}

void ge04_prebirth_custody_init(struct ge04_journal_custody *custody) {
    if (custody) reset_custody(custody);
}

void ge04_prebirth_close(struct ge04_journal_custody *custody) {
    if (!custody) return;
    if (custody->owned == 1) {
        if (custody->journal_fd >= 0) close(custody->journal_fd);
        if (custody->directory_fd >= 0) close(custody->directory_fd);
    }
    reset_custody(custody);
}

static int nofollow_root_directory(void) {
    int root = open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (root_parent_dir(root) < 0) {
        if (root >= 0) close(root);
        return -1;
    }
    int var = openat(root, "var",
                     O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    close(root);
    if (root_parent_dir(var) < 0) {
        if (var >= 0) close(var);
        return -1;
    }
    int lib = openat(var, "lib",
                     O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    close(var);
    if (root_parent_dir(lib) < 0) {
        if (lib >= 0) close(lib);
        return -1;
    }
    int dir = openat(lib, "alix-ge04",
                     O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    close(lib);
    if (root_private_dir(dir, 0700) < 0) {
        if (dir >= 0) close(dir);
        return -1;
    }
    return dir;
}

static int read_all_at(int fd, char *bytes, size_t expected) {
    size_t offset = 0;
    while (offset < expected) {
        ssize_t read_bytes = pread(fd, bytes + offset, expected - offset,
                                  (off_t)offset);
        if (read_bytes < 0 && errno == EINTR) continue;
        if (read_bytes <= 0) return refuse(EIO);
        offset += (size_t)read_bytes;
    }
    char trailer;
    if (pread(fd, &trailer, 1, (off_t)expected) != 0) return refuse(EIO);
    return 0;
}

int ge04_prebirth_recheck(const struct ge04_prebirth_claim *claim,
                          const struct ge04_journal_custody *custody) {
    if (geteuid() != 0 || getuid() != 0 ||
        !custody || custody->owned != 1 ||
        custody->directory_fd < 0 || custody->journal_fd < 0)
        return refuse(EPERM);
    char encoded[GE04_PREBIRTH_MAX];
    size_t length;
    if (ge04_prebirth_encode(claim, encoded, &length) < 0) return -1;
    struct stat pinned, named;
    if (root_private_dir(custody->directory_fd, 0700) < 0 ||
        original_file(custody->journal_fd, &pinned) < 0 ||
        fstatat(custody->directory_fd, GE04_PREBIRTH_FILE, &named,
                AT_SYMLINK_NOFOLLOW) < 0 ||
        !S_ISREG(named.st_mode) ||
        named.st_dev != pinned.st_dev || named.st_ino != pinned.st_ino ||
        (unsigned long long)pinned.st_dev != custody->device ||
        (unsigned long long)pinned.st_ino != custody->inode ||
        (size_t)pinned.st_size != length)
        return refuse(EPERM);
    char observed[GE04_PREBIRTH_MAX];
    if (read_all_at(custody->journal_fd, observed, length) < 0 ||
        memcmp(encoded, observed, length) != 0)
        return refuse(EIO);
    return 0;
}

int ge04_prebirth_stage(const struct ge04_prebirth_claim *claim,
                        struct ge04_journal_custody *custody) {
    if (geteuid() != 0 || getuid() != 0 || getegid() != 0 || getgid() != 0)
        return refuse(EPERM);
    if (!custody) return refuse(EINVAL);

    /* Refuse to overwrite caller-held descriptors. Only a reset struct may
     * enter; this primitive cannot adopt or recover a previous attempt.
     */
    if (custody->owned != 0 || custody->directory_fd != -1 ||
        custody->journal_fd != -1 ||
        custody->device != 0 || custody->inode != 0)
        return refuse(EBUSY);

    char encoded[GE04_PREBIRTH_MAX];
    size_t length;
    if (ge04_prebirth_encode(claim, encoded, &length) < 0) return -1;
    int dir = nofollow_root_directory();
    if (dir < 0) return -1;
    int fd = openat(dir, GE04_PREBIRTH_FILE,
                    O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC |
                    O_NONBLOCK, 0600);
    if (fd < 0) {
        close(dir);
        return -1;
    }
    /* From here on failure deliberately leaves a possibly partial journal.
     * A protected external issuer must treat this as permanently uncertain.
     */
    struct stat s;
    int ok = 0;
    if (fstat(fd, &s) == 0 && S_ISREG(s.st_mode) &&
        s.st_uid == 0 && s.st_gid == 0 && s.st_nlink == 1 &&
        (s.st_mode & 07777) == 0600) {
        size_t offset = 0;
        while (offset < length) {
            ssize_t n = write(fd, encoded + offset, length - offset);
            if (n < 0 && errno == EINTR) continue;
            if (n <= 0) break;
            offset += (size_t)n;
        }
        if (offset == length && fsync(fd) == 0 && fsync(dir) == 0) {
            custody->directory_fd = dir;
            custody->journal_fd = fd;
            custody->device = (unsigned long long)s.st_dev;
            custody->inode = (unsigned long long)s.st_ino;
            custody->owned = 1;
            if (ge04_prebirth_recheck(claim, custody) == 0)
                ok = 1;
            if (!ok) reset_custody(custody);
        }
    }
    if (ok) return 0;
    int error = errno ? errno : EIO;
    close(fd);
    close(dir);
    return refuse(error);
}
