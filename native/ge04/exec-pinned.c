#define _GNU_SOURCE
#include <fcntl.h>
#include <stdio.h>
#include <unistd.h>
#include <errno.h>
#include <string.h>
extern char **environ;
/* The trusted launcher receives the already-verified executable as fd 4.
 * The peercred helper receives the accepted socket as fd 3 unchanged.
 */
int main(void) {
  char *const argv[] = {(char *)"peercred", NULL};
  execveat(4, "", argv, environ, AT_EMPTY_PATH);
  fprintf(stderr, "execveat pinned helper failed: %s\n", strerror(errno));
  return 126;
}
