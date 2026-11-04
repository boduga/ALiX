// GE-04 SUP-04 isolated pidfd-to-attempt observation.
// Test-only, no GE-04 helper execution, authority, receipt or replay.
#define _GNU_SOURCE
#include <linux/sched.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static int valid_attempt(const char *s) {
  if (strlen(s) != 36) return 0;
  for (int i = 0; i < 36; i++) {
    if (i == 8 || i == 13 || i == 18 || i == 23) {
      if (s[i] != '-') return 0;
    } else if (!((s[i] >= '0' && s[i] <= '9') ||
                 (s[i] >= 'a' && s[i] <= 'f'))) return 0;
  }
  return s[14] == '4' && strchr("89ab", s[19]) != NULL;
}

static int verified_prespawn(int dir, const char *attempt) {
  char name[48];
  snprintf(name, sizeof(name), "%s.json", attempt);
  int fd = openat(dir, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0) return -1;
  struct stat a, b;
  int ok = fstat(fd, &a) == 0 && S_ISREG(a.st_mode) &&
           a.st_uid == geteuid() && a.st_nlink == 1 &&
           !(a.st_mode & 0077) && a.st_size > 0 && a.st_size <= 4096;
  // The existing Python ledger classifier checks the strict JSON schema.
  // This native prototype deliberately does not claim independent admission.
  char buf[4097];
  ssize_t n = ok ? read(fd, buf, sizeof(buf)) : -1;
  if (fstat(fd, &b) != 0 || n != a.st_size ||
      a.st_dev != b.st_dev || a.st_ino != b.st_ino ||
      a.st_size != b.st_size || a.st_mtim.tv_nsec != b.st_mtim.tv_nsec ||
      a.st_ctim.tv_nsec != b.st_ctim.tv_nsec) ok = 0;
  close(fd);
  return ok ? 0 : -1;
}

static int reserve_attempt(int dir, const char *attempt) {
  char name[64];
  snprintf(name, sizeof(name), "%s.pidfd-started", attempt);
  int fd = openat(dir, name, O_WRONLY | O_CREAT | O_EXCL |
                  O_NOFOLLOW | O_CLOEXEC, 0600);
  if (fd < 0) return -1;
  const char entry[] = "GE04_SUP04_V1 state=IN_PROGRESS_UNVERIFIED admission=NOT_AUTHORIZED\n";
  int ok = write(fd, entry, sizeof(entry) - 1) == (ssize_t)(sizeof(entry) - 1);
  if (ok && fsync(fd) != 0) ok = 0;
  if (close(fd) != 0) ok = 0;
  if (ok && fsync(dir) != 0) ok = 0;
  return ok ? 0 : -1;
}

static int persist_observation(int dir, const char *attempt, const char *outcome,
                               pid_t observed_child) {
  char name[64];
  snprintf(name, sizeof(name), "%s.pidfd-unverified", attempt);
  int fd = openat(dir, name, O_WRONLY | O_CREAT | O_EXCL |
                  O_NOFOLLOW | O_CLOEXEC, 0600);
  if (fd < 0) return -1;
  char data[320];
  int size = snprintf(data, sizeof(data),
      "GE04_SUP04_V1 attempt=%s child=%ld outcome=%s admission=NOT_AUTHORIZED\n",
      attempt, (long)observed_child, outcome);
  int ok = size > 0 && size < (int)sizeof(data);
  for (int pos = 0; ok && pos < size;) {
    ssize_t n = write(fd, data + pos, size - pos);
    if (n < 0 && errno == EINTR) continue;
    if (n <= 0) { ok = 0; break; }
    pos += (int)n;
  }
  if (ok && fsync(fd) != 0) ok = 0;
  if (close(fd) != 0) ok = 0;
  if (ok && fsync(dir) != 0) ok = 0;
  return ok ? 0 : -1;
}

static int run(const char *directory, const char *attempt, const char *mode) {
  if (!valid_attempt(attempt)) return 2;
  int dir = open(directory, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (dir < 0) return 3;
  struct stat st;
  if (fstat(dir, &st) != 0 || !S_ISDIR(st.st_mode) ||
      st.st_uid != geteuid() || (st.st_mode & 0077) ||
      verified_prespawn(dir, attempt) != 0) {
    close(dir);
    return 3;
  }
  if (!strcmp(mode, "unsupported")) { close(dir); return 77; }
  // O_EXCL/fsync happens BEFORE child creation. An orphaned reservation
  // remains UNCERTAIN and cannot be silently reused.
  if (reserve_attempt(dir, attempt) != 0) { close(dir); return 6; }
  int pidfd = -1;
  struct clone_args args = {0};
  args.flags = CLONE_PIDFD;
  args.pidfd = (uint64_t)(uintptr_t)&pidfd;
  args.exit_signal = SIGCHLD;
  long pid = syscall(SYS_clone3, &args, sizeof(args));
  if (pid < 0) { close(dir); return 77; }
  if (!pid) {
    close(dir);
    if (!strcmp(mode, "kill")) for (;;) pause();
    if (!strcmp(mode, "forged")) {
      const char msg[] = "RECEIPT_DURABLE SUCCESS fsynced\\n";
      (void)write(STDOUT_FILENO, msg, sizeof(msg) - 1);
    }
    _exit(!strcmp(mode, "nonzero") ? 9 : 0);
  }
  if (pidfd < 0) {
    (void)kill((pid_t)pid, SIGKILL);
    (void)waitpid((pid_t)pid, NULL, 0);
    close(dir);
    return 4;
  }

  int rc = 5;
  if (!strcmp(mode, "kill") &&
      syscall(SYS_pidfd_send_signal, pidfd, SIGKILL, NULL, 0) != 0) {
    (void)syscall(SYS_pidfd_send_signal, pidfd, SIGKILL, NULL, 0);
    (void)waitpid((pid_t)pid, NULL, 0);
    close(pidfd);
    close(dir);
    return 5;
  }
  struct pollfd watcher = {.fd = pidfd, .events = POLLIN};
  int n;
  do { n = poll(&watcher, 1, 3000); } while (n < 0 && errno == EINTR);
  if (n == 1 && (watcher.revents & POLLIN)) {
    siginfo_t info = {0};
    if (waitid(P_PIDFD, (id_t)pidfd, &info, WEXITED) == 0 &&
        info.si_pid == (pid_t)pid) {
      const char *outcome = "PROCESS_OUTCOME_UNVERIFIED";
      if (info.si_code == CLD_EXITED && info.si_status == 0)
        outcome = "PROCESS_EXIT_ZERO_UNVERIFIED";
      else if (info.si_code == CLD_EXITED)
        outcome = "PROCESS_EXIT_NONZERO_UNVERIFIED";
      else if (info.si_code == CLD_KILLED || info.si_code == CLD_DUMPED)
        outcome = "PROCESS_SIGNALED_UNVERIFIED";
      if (!strcmp(mode, "crash-before-record")) _exit(88);
      rc = persist_observation(dir, attempt, outcome, (pid_t)pid) == 0 ? 0 : 6;
    }
  }
  if (rc == 5) {
    (void)syscall(SYS_pidfd_send_signal, pidfd, SIGKILL, NULL, 0);
    (void)waitpid((pid_t)pid, NULL, 0);
    // A missing durable record is UNKNOWN; never infer no mutation.
  }
  close(pidfd);
  close(dir);
  return rc;
}

int main(int argc, char **argv) {
  if (argc != 4) return 2;
  if (strcmp(argv[3], "zero") && strcmp(argv[3], "nonzero") &&
      strcmp(argv[3], "kill") && strcmp(argv[3], "forged") &&
      strcmp(argv[3], "crash-before-record") &&
      strcmp(argv[3], "unsupported")) return 2;
  return run(argv[1], argv[2], argv[3]);
}
