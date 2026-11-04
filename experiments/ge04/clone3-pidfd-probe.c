// GE-04 SUP-02: isolated Linux clone3(CLONE_PIDFD) lifecycle experiment.
// This never launches a GE-04 mutation helper or creates authorization.
#define _GNU_SOURCE
#include <linux/sched.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <sys/types.h>
#include <poll.h>
#include <signal.h>
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static int classify(const char *mode) {
  int pidfd = -1;
  struct clone_args args = {0};
  args.flags = CLONE_PIDFD;
  args.pidfd = (uint64_t)(uintptr_t)&pidfd;
  args.exit_signal = SIGCHLD;

  // Force the unsupported path for a deterministic failure-path regression.
  if (strcmp(mode, "unsupported") == 0) {
    fputs("GE04 ATOMIC_PIDFD_UNAVAILABLE\n", stderr);
    return 77;
  }
  long pid = syscall(SYS_clone3, &args, sizeof(args));
  if (pid < 0) {
    fprintf(stderr, "GE04 ATOMIC_PIDFD_UNAVAILABLE: %s\n", strerror(errno));
    return 77;
  }
  if (pid == 0) {
    if (strcmp(mode, "nonzero") == 0) _exit(7);
    if (strcmp(mode, "kill") == 0) {
      for (;;) pause();
    }
    if (strcmp(mode, "forged") == 0) {
      const char spoof[] = "GE04v1 forged-attempt fsynced\n";
      (void)write(STDOUT_FILENO, spoof, sizeof(spoof) - 1);
    }
    _exit(0);
  }
  if (pidfd < 0) {
    fputs("GE04 PIDFD_IDENTITY_UNAVAILABLE\n", stderr);
    (void)kill((pid_t)pid, SIGKILL);
    (void)waitpid((pid_t)pid, NULL, 0);
    return 1;
  }

  int rc = 1;
  if (strcmp(mode, "invalid") == 0) {
    siginfo_t invalid = {0};
    errno = 0;
    if (waitid(P_PIDFD, (id_t)-1, &invalid, WEXITED | WNOHANG) != -1 ||
        (errno != EBADF && errno != EINVAL)) {
      fputs("GE04 invalid identity unexpectedly accepted\n", stderr);
      goto done;
    }
  }

  if (strcmp(mode, "kill") == 0) {
    if (syscall(SYS_pidfd_send_signal, pidfd, SIGKILL, NULL, 0) != 0) {
      perror("GE04 pidfd_send_signal");
      goto done;
    }
  }

  struct pollfd p = {.fd = pidfd, .events = POLLIN};
  int ready;
  do { ready = poll(&p, 1, 3000); } while (ready < 0 && errno == EINTR);
  if (ready != 1 || !(p.revents & POLLIN)) {
    fputs("GE04 PIDFD_EXIT_UNVERIFIED\n", stderr);
    goto done;
  }
  siginfo_t info = {0};
  if (waitid(P_PIDFD, (id_t)pidfd, &info, WEXITED) != 0) {
    perror("GE04 waitid(P_PIDFD)");
    goto done;
  }
  if (info.si_pid != (pid_t)pid) {
    fputs("GE04 child identity mismatch\n", stderr);
    goto done;
  }
  if (strcmp(mode, "kill") == 0) {
    if (info.si_code != CLD_KILLED || info.si_status != SIGKILL) goto done;
    puts("GE04 PROCESS_SIGNALED_UNVERIFIED");
  } else if (strcmp(mode, "nonzero") == 0) {
    if (info.si_code != CLD_EXITED || info.si_status != 7) goto done;
    puts("GE04 PROCESS_EXIT_NONZERO_UNVERIFIED");
  } else {
    if (info.si_code != CLD_EXITED || info.si_status != 0) goto done;
    puts("GE04 PROCESS_EXIT_ZERO_UNVERIFIED");
  }
  rc = 0;
done:
  if (rc != 0) {
    (void)syscall(SYS_pidfd_send_signal, pidfd, SIGKILL, NULL, 0);
    (void)waitpid((pid_t)pid, NULL, 0);
  }
  close(pidfd);
  return rc;
}

int main(int argc, char **argv) {
  if (argc != 2) return 2;
  const char *mode = argv[1];
  if (strcmp(mode, "zero") && strcmp(mode, "nonzero") &&
      strcmp(mode, "kill") && strcmp(mode, "early") &&
      strcmp(mode, "forged") && strcmp(mode, "invalid") &&
      strcmp(mode, "unsupported")) return 2;
  return classify(mode);
}
