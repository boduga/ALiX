// Linux-only experiment: pin owned directory before creating a leaf beneath it.
// No policy/lease integration; not a production authorization boundary.
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/openat2.h>
#include <stdio.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>

static int beneath(int fd, const char *path, int flags, unsigned mode) {
  struct open_how how = {.flags = (unsigned long long)flags, .mode = mode,
    .resolve = RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS};
  return (int)syscall(SYS_openat2, fd, path, &how, sizeof(how));
}
int main(int argc, char **argv) {
  if (argc != 5) { fprintf(stderr, "usage: scoped-owned-create WORKSPACE OWNED_DIR RELATIVE_FILE CONTENT\n"); return 2; }
  int root = open(argv[1], O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (root < 0) { perror("workspace"); return 3; }
  int owned = beneath(root, argv[2], O_RDONLY | O_DIRECTORY | O_CLOEXEC, 0);
  if (owned < 0) { perror("owned scope"); close(root); return 4; }
  // The owned directory is now pinned. Renaming or replacing its pathname
  // cannot redirect this fd to an unrelated unowned directory.
  int file = beneath(owned, argv[3], O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
  if (file < 0) { perror("owned create"); close(owned); close(root); return 5; }
  size_t size = strlen(argv[4]), written = 0;
  while (written < size) {
    ssize_t n = write(file, argv[4] + written, size - written);
    if (n < 0 && errno == EINTR) continue;
    if (n <= 0) { perror("write"); close(file); close(owned); close(root); return 6; }
    written += (size_t)n;
  }
  int result = close(file);
  close(owned); close(root);
  if (result != 0) { perror("close"); return 7; }
  return 0;
}
