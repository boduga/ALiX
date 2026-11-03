// Linux-only experiment: pin owned directory before creating a leaf beneath it.
// No policy/lease integration; not a production authorization boundary.
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/openat2.h>
#include <sys/prctl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
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
  // Kernel-delivered SIGKILL if the immediate spawning parent exits. The
  // parent identity check closes the race where it dies before prctl().
  pid_t parent_pid = getppid();
  if (parent_pid <= 1 || prctl(PR_SET_PDEATHSIG, SIGKILL) != 0 || getppid() != parent_pid) {
    fprintf(stderr, "GE04 parent lifetime binding failed\n"); return 14;
  }
  // Validate optional supervisor notification configuration before any mutation.
  const char *receipt_fd_env = getenv("GE04_RECEIPT_FD");
  const char *attempt_id = getenv("GE04_ATTEMPT_ID");
  int receipt_fd = -1;
  if (receipt_fd_env || attempt_id) {
    if (!receipt_fd_env || !attempt_id || strlen(attempt_id) != 36 ||
        strspn(attempt_id, "0123456789abcdefABCDEF-") != 36 ||
        attempt_id[8] != '-' || attempt_id[13] != '-' ||
        attempt_id[18] != '-' || attempt_id[23] != '-') {
      fprintf(stderr, "GE04 invalid terminal notification binding\n"); return 15;
    }
    char *end = NULL;
    errno = 0;
    long parsed = strtol(receipt_fd_env, &end, 10);
    if (errno || !end || *end || parsed < 3 || parsed > 1024 ||
        fcntl((int)parsed, F_GETFD) == -1) {
      fprintf(stderr, "GE04 invalid notification fd\n"); return 15;
    }
    receipt_fd = (int)parsed;
  }
  int root = open(argv[1], O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (root < 0) { perror("workspace"); return 3; }
  int owned = beneath(root, argv[2], O_RDONLY | O_DIRECTORY | O_CLOEXEC, 0);
  if (owned < 0) { perror("owned scope"); close(root); return 4; }
  // Pin the *containing* directory before any synchronization barrier or
  // mutation. Reopening it by pathname after create could fsync a replacement.
  char *parent_path = strdup(argv[3]);
  if (!parent_path) { perror("parent allocation"); close(owned); close(root); return 12; }
  char *slash = strrchr(parent_path, '/');
  int parent = owned;
  const char *leaf = argv[3];
  if (slash) {
    *slash = '\0';
    leaf = slash + 1;
    parent = beneath(owned, parent_path, O_RDONLY | O_DIRECTORY | O_CLOEXEC, 0);
    if (parent < 0) { perror("open containing directory"); free(parent_path); close(owned); close(root); return 13; }
  }
  if (!*leaf) { fprintf(stderr, "empty leaf\n"); if (parent != owned) close(parent); free(parent_path); close(owned); close(root); return 5; }
#ifdef GE04_TEST_HOOKS
  // Test-only synchronization point. Production binaries MUST NOT enable this.
  const char *ready_env = getenv("GE04_READY_FD");
  const char *continue_env = getenv("GE04_CONTINUE_FD");
  if (ready_env && continue_env) {
    int ready_fd = atoi(ready_env), continue_fd = atoi(continue_env);
    if (write(ready_fd, "R", 1) != 1) { perror("ready"); close(owned); close(root); return 8; }
    char signal;
    if (read(continue_fd, &signal, 1) != 1 || signal != 'C') {
      fprintf(stderr, "test synchronization failed\n"); close(owned); close(root); return 9;
    }
  }
#endif
  // The owned directory is now pinned. Renaming or replacing its pathname
  // cannot redirect this fd to an unrelated unowned directory.
  int file = beneath(parent, leaf, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
  if (file < 0) { perror("owned create"); close(owned); close(root); return 5; }
  size_t size = strlen(argv[4]), written = 0;
  while (written < size) {
    ssize_t n = write(file, argv[4] + written, size - written);
    if (n < 0 && errno == EINTR) continue;
    if (n <= 0) { perror("write"); close(file); close(owned); close(root); return 6; }
    written += (size_t)n;
  }
  // A zero exit must not precede persistence of the created bytes and
  // directory entry. fsync errors are ambiguous: creation may already exist.
  if (fsync(file) != 0) { perror("fsync file"); close(file); close(owned); close(root); return 10; }
  if (close(file) != 0) { perror("close file"); close(owned); close(root); return 7; }
  // Sync the same pinned directory fd used to create the leaf, even if
  // its original pathname was renamed or replaced during execution.
  int synced = fsync(parent);
  free(parent_path);
  if (parent != owned) close(parent);
  if (synced != 0) { perror("fsync containing directory"); close(owned); close(root); return 11; }
  // Experimental terminal notification over a supervisor-provided fd.
  // This is NOT a durable/authenticated receipt: an untrusted process can
  // spoof env values or a writable fd, and a crash can lose the notification.
  if (receipt_fd >= 0) {
    char receipt[96];
    int len = snprintf(receipt, sizeof(receipt), "GE04v1 %s fsynced\n", attempt_id);
    if (len <= 0 || (size_t)len >= sizeof(receipt) || write(receipt_fd, receipt, (size_t)len) != len) {
      perror("GE04 terminal notification"); close(owned); close(root); return 16;
    }
  }
  close(owned); close(root);
  return 0;
}
