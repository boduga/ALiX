// GE-04 TEMPORARY TEST-ONLY kernel write primitive.
// Compiled by a privileged CI test into a disposable directory. NEVER install.
// Only accepts an inherited pinned directory FD and a fixed inert fixture leaf.
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/openat2.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

int main(int argc, char **argv) {
  if (argc != 3 || strcmp(argv[1], "GE04-INERT-FIXTURE-V1") != 0) return 2;
  char *end = NULL;
  errno = 0;
  long raw = strtol(argv[2], &end, 10);
  if (errno || !end || *end || raw < 3 || raw > 1048576) return 3;
  const int pinned = (int)raw;
  struct stat dir;
  if (fstat(pinned, &dir) != 0 || !S_ISDIR(dir.st_mode)) return 4;
  const char *leaf = "ge04-inert-effect.bin";
  const char *body = "GE04_INERT_KERNEL_WRITE_NO_PRODUCTION_AUTHORITY\n";
  struct open_how how = {
    .flags = O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW,
    .mode = 0600,
    .resolve = RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS
  };
  int file = (int)syscall(SYS_openat2, pinned, leaf, &how, sizeof(how));
  if (file < 0) return 5;
  size_t size = strlen(body), pos = 0;
  while (pos < size) {
    ssize_t n = write(file, body + pos, size - pos);
    if (n < 0 && errno == EINTR) continue;
    if (n <= 0) { close(file); return 6; }
    pos += (size_t)n;
  }
  if (fsync(file) != 0) { close(file); return 7; }
  if (close(file) != 0 || fsync(pinned) != 0) return 8;
  // Simulates a lost terminal notification AFTER a real kernel effect:
  // the supervisor MUST quarantine and NEVER automatically replay.
  if (getenv("GE04_TEST_LOSE_TERMINAL")) _exit(86);
  puts("GE04_NATIVE_FIXTURE_FSYNCED_UNVERIFIED");
  return 0;
}
