#define _GNU_SOURCE
#include <sys/socket.h>
#include <sys/types.h>
#include <stdio.h>
#include <unistd.h>
#include <errno.h>
#include <string.h>
int main(void) {
  struct ucred cred;
  socklen_t size = sizeof(cred);
  if (getsockopt(3, SOL_SOCKET, SO_PEERCRED, &cred, &size) != 0 || size != sizeof(cred) || cred.pid <= 0) {
    fprintf(stderr, "SO_PEERCRED failed: %s\n", strerror(errno));
    return 1;
  }
  if (printf("%ld %ld %ld\n", (long)cred.pid, (long)cred.uid, (long)cred.gid) < 0) return 1;
  return 0;
}
