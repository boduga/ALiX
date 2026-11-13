/* GE-04 root issuer first-attempt fence: SOURCE CANDIDATE only.
 * No installed entrypoint calls this library. Never adopt or retry.
 */
#define _GNU_SOURCE
#include "protected-attempt-fence.h"
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/random.h>
#include <sys/stat.h>
#include <unistd.h>

static int deny(int n) { errno = n; return -1; }
static int is_root(void) {
    return getuid() == 0 && geteuid() == 0 &&
           getgid() == 0 && getegid() == 0;
}

int ge04_read_kernel_boot_id(char boot_id[33]) {
    if (!boot_id) return deny(EINVAL);
    int fd = open("/proc/sys/kernel/random/boot_id",
                  O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK);
    if (fd < 0) return -1;
    char raw[38] = {0};
    ssize_t count;
    do { count = read(fd, raw, sizeof(raw)); } while (count < 0 && errno == EINTR);
    int saved = errno;
    close(fd);
    if (count < 0) return deny(saved);
    if (count != 37 || raw[36] != '\n') return deny(EINVAL);
    size_t j = 0;
    for (size_t i = 0; i < 36; ++i) {
        if (i == 8 || i == 13 || i == 18 || i == 23) {
            if (raw[i] != '-') return deny(EINVAL);
        } else {
            char x = raw[i];
            if (!((x >= '0' && x <= '9') ||
                  (x >= 'a' && x <= 'f'))) return deny(EINVAL);
            boot_id[j++] = x;
        }
    }
    boot_id[32] = 0;
    return 0;
}

void ge04_attempt_custody_init(struct ge04_attempt_custody *held) {
    if (!held) return;
    held->directory_fd = -1;
    held->fence_fd = -1;
    held->device = 0;
    held->inode = 0;
    held->owned = 0;
}

void ge04_attempt_close(struct ge04_attempt_custody *held) {
    if (!held) return;
    if (held->owned == 1) {
        if (held->fence_fd >= 0) close(held->fence_fd);
        if (held->directory_fd >= 0) close(held->directory_fd);
    }
    ge04_attempt_custody_init(held);
}

int ge04_attempt_fence_encode(const struct ge04_prebirth_claim *claim,
                      char out[GE04_ATTEMPT_MAX], size_t *size) {
    if (!claim || !out || !size || claim->attempt != 1 ||
        strnlen(claim->boot_id, 33) != 32 ||
        strnlen(claim->nonce, 65) != 64) return deny(EINVAL);
    for (size_t i = 0; i < 32; ++i) {
        char x = claim->boot_id[i];
        if (!((x >= '0' && x <= '9') ||
              (x >= 'a' && x <= 'f'))) return deny(EINVAL);
    }
    for (size_t i = 0; i < 64; ++i) {
        char x = claim->nonce[i];
        if (!((x >= '0' && x <= '9') ||
              (x >= 'a' && x <= 'f'))) return deny(EINVAL);
    }
    char check[GE04_PREBIRTH_MAX];
    size_t check_length;
    if (ge04_prebirth_encode(claim, check, &check_length) != 0)
        return deny(EINVAL);
    (void)check_length;
    int n = snprintf(out, GE04_ATTEMPT_MAX,
                     "GE04AF1 %s %s %s %s 1\n",
                     claim->boot_id, claim->nonce,
                     claim->source_sha256, claim->controller_sha256);
    if (n <= 0 || n >= GE04_ATTEMPT_MAX) return deny(EOVERFLOW);
    *size = (size_t)n;
    return 0;
}

int ge04_attempt_recheck(const struct ge04_prebirth_claim *claim,
                         const struct ge04_attempt_custody *held) {
    if (!is_root() || !held || held->owned != 1 ||
        held->directory_fd < 0 || held->fence_fd < 0)
        return deny(EPERM);
    char content[GE04_ATTEMPT_MAX], boot[33];
    size_t size;
    if (ge04_attempt_fence_encode(claim, content, &size) != 0 ||
        ge04_read_kernel_boot_id(boot) != 0 ||
        strcmp(boot, claim->boot_id) != 0) return deny(EPERM);
    struct stat dir, fd, named;
    if (fstat(held->directory_fd, &dir) != 0 ||
        !S_ISDIR(dir.st_mode) || dir.st_uid != 0 || dir.st_gid != 0 ||
        (dir.st_mode & 07777) != 0700 ||
        fstat(held->fence_fd, &fd) != 0 ||
        !S_ISREG(fd.st_mode) || fd.st_uid != 0 || fd.st_gid != 0 ||
        fd.st_nlink != 1 || (fd.st_mode & 07777) != 0600 ||
        fd.st_size != (off_t)size ||
        fstatat(held->directory_fd, GE04_ATTEMPT_FILE,
                &named, AT_SYMLINK_NOFOLLOW) != 0 ||
        !S_ISREG(named.st_mode) ||
        named.st_dev != fd.st_dev || named.st_ino != fd.st_ino ||
        (unsigned long long)fd.st_dev != held->device ||
        (unsigned long long)fd.st_ino != held->inode)
        return deny(EPERM);
    char observed[GE04_ATTEMPT_MAX];
    size_t offset = 0;
    while (offset < size) {
        ssize_t n = pread(held->fence_fd, observed + offset,
                          size - offset, (off_t)offset);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) return deny(EIO);
        offset += (size_t)n;
    }
    char trailer;
    if (pread(held->fence_fd, &trailer, 1, (off_t)size) != 0 ||
        memcmp(observed, content, size) != 0) return deny(EIO);
    return 0;
}

int ge04_attempt_begin(struct ge04_prebirth_claim *claim,
                       struct ge04_attempt_custody *held) {
    if (!is_root()) return deny(EPERM);
    if (!claim || !held) return deny(EINVAL);
    if (held->directory_fd != -1 || held->fence_fd != -1 ||
        held->owned != 0 || held->device != 0 || held->inode != 0)
        return deny(EBUSY);
    /* Never adopt caller-supplied identity. */
    struct ge04_prebirth_claim proposed = {0};
    memcpy(proposed.source_sha256, claim->source_sha256,
           sizeof(proposed.source_sha256));
    memcpy(proposed.controller_sha256, claim->controller_sha256,
           sizeof(proposed.controller_sha256));
    if (ge04_read_kernel_boot_id(proposed.boot_id) != 0) return -1;
    proposed.attempt = 1; /* no rollover until independently reviewed recovery */
    unsigned char entropy[32];
    size_t filled = 0;
    while (filled < sizeof(entropy)) {
        ssize_t n = getrandom(entropy + filled, sizeof(entropy) - filled, 0);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) return deny(EIO);
        filled += (size_t)n;
    }
    static const char hex[] = "0123456789abcdef";
    for (size_t i = 0; i < sizeof(entropy); ++i) {
        proposed.nonce[2*i] = hex[entropy[i] >> 4];
        proposed.nonce[2*i+1] = hex[entropy[i] & 15];
    }
    proposed.nonce[64] = 0;
    char prebirth[GE04_PREBIRTH_MAX];
    size_t prebirth_size;
    if (ge04_prebirth_encode(&proposed, prebirth, &prebirth_size) != 0)
        return -1;
    (void)prebirth_size;
    int dir = ge04_open_protected_directory();
    if (dir < 0) return -1;
    int fd = openat(dir, GE04_ATTEMPT_FILE,
                    O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW |
                    O_NONBLOCK | O_CLOEXEC, 0600);
    if (fd < 0) { close(dir); return -1; }
    /* Any failure after O_EXCL leaves a permanent uncertain attempt. */
    char text[GE04_ATTEMPT_MAX];
    size_t len;
    struct stat statbuf;
    int success = 0;
    if (ge04_attempt_fence_encode(&proposed, text, &len) == 0 &&
        fstat(fd, &statbuf) == 0 && S_ISREG(statbuf.st_mode) &&
        statbuf.st_uid == 0 && statbuf.st_gid == 0 &&
        statbuf.st_nlink == 1 && (statbuf.st_mode & 07777) == 0600) {
        size_t written = 0;
        while (written < len) {
            ssize_t n = write(fd, text + written, len - written);
            if (n < 0 && errno == EINTR) continue;
            if (n <= 0) break;
            written += (size_t)n;
        }
        if (written == len && fsync(fd) == 0 && fsync(dir) == 0) {
            held->directory_fd = dir;
            held->fence_fd = fd;
            held->device = (unsigned long long)statbuf.st_dev;
            held->inode = (unsigned long long)statbuf.st_ino;
            held->owned = 1;
            if (ge04_attempt_recheck(&proposed, held) == 0) success = 1;
            if (!success) ge04_attempt_custody_init(held);
        }
    }
    if (success) { *claim = proposed; return 0; }
    int error = errno ? errno : EIO;
    close(fd);
    close(dir);
    return deny(error);
}
