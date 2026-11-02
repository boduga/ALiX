// Linux-only experimental fd-relative create. NOT a production authorization service.
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

static int beneath(int dirfd, const char *path, int flags, mode_t mode) {
  struct open_how how = { .flags = (unsigned long long)flags,
    .mode = mode,
    .resolve = RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS };
  return (int)syscall(SYS_openat2, dirfd, path, &how, sizeof(how));
}

int main(int argc, char **argv) {
  if (argc != 4) { fprintf(stderr, "usage: scoped-create WORKSPACE RELATIVE_FILE CONTENT\n"); return 2; }
  int root = open(argv[1], O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
  if (root < 0) { perror("workspace"); return 3; }
  const char *relative = argv[2];
  if (!*relative || relative[0] == '/') { fprintf(stderr, "invalid relative path\n"); close(root); return 4; }
  int file = beneath(root, relative, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
  if (file < 0) { perror("openat2 create"); close(root); return 5; }
  size_t size = strlen(argv[3]), written = 0;
  while (written < size) {
    ssize_t n = write(file, argv[3] + written, size - written);
    if (n < 0 && errno == EINTR) continue;
    if (n <= 0) { perror("write"); close(file); close(root); return 6; }
    written += (size_t)n;
  }
  if (close(file) != 0) { perror("close"); close(root); return 7; }
  close(root);
  return 0;
}
