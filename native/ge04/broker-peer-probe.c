#define _GNU_SOURCE
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <unistd.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <errno.h>
#include <signal.h>

/* Q3.25 credential-free, one-shot qualification probe. NOT a credential broker. */
int main(int argc, char **argv) {
  if (argc != 4) { fprintf(stderr, "usage: probe SOCKET BROKER_UID ALLOWED_UID\n"); return 64; }
  char *end = NULL;
  errno = 0; unsigned long broker = strtoul(argv[2], &end, 10);
  if (errno || !end || *end || broker > 4294967295UL) return 64;
  errno = 0; unsigned long allowed = strtoul(argv[3], &end, 10);
  if (errno || !end || *end || allowed > 4294967295UL || allowed == broker) return 64;
  struct sockaddr_un addr = { .sun_family = AF_UNIX };
  if (strlen(argv[1]) >= sizeof(addr.sun_path)) return 64;
  memcpy(addr.sun_path, argv[1], strlen(argv[1]) + 1);
  signal(SIGPIPE, SIG_IGN);
  int listener = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (listener < 0) return 1;
  if (bind(listener, (struct sockaddr *)&addr, sizeof(addr)) != 0) { perror("bind"); close(listener); return 1; }
  if (chmod(argv[1], 0600) != 0 || listen(listener, 1) != 0) { perror("listen/chmod"); close(listener); unlink(argv[1]); return 1; }
  puts("READY"); fflush(stdout);
  int client = accept4(listener, NULL, NULL, SOCK_CLOEXEC);
  int result = 1;
  if (client >= 0) {
    struct ucred cred; socklen_t len = sizeof(cred);
    if (getsockopt(client, SOL_SOCKET, SO_PEERCRED, &cred, &len) == 0 && len == sizeof(cred) && cred.pid > 0) {
      int authorized = (unsigned long)cred.uid == allowed && (unsigned long)cred.uid != broker;
      const char *reply = authorized ? "OK\n" : "DENIED\n";
      ssize_t written = write(client, reply, strlen(reply));
      if (written != (ssize_t)strlen(reply)) result = 1;
      printf("PEER pid=%ld uid=%ld authorized=%d\n", (long)cred.pid, (long)cred.uid, authorized); fflush(stdout);
      if (written == (ssize_t)strlen(reply)) result = 0;
    }
    close(client);
  }
  close(listener); unlink(argv[1]); return result;
}
