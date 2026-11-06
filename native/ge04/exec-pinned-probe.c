#define _GNU_SOURCE
#include <fcntl.h>
#include <stdio.h>
#include <unistd.h>
#include <errno.h>
#include <string.h>
/* Q3.29: launcher gets an already opened executable on fd 3.
 * Arguments are forwarded unchanged. No credential material is handled.
 * The launcher itself still needs immutable trusted deployment.
 */
int main(int argc, char **argv) {
  if (argc != 4 && argc != 5) return 64;
  execveat(3, "", argv, (char *const[]){"PATH=/usr/bin:/bin", NULL}, AT_EMPTY_PATH);
  fprintf(stderr, "execveat pinned probe failed: %s\n", strerror(errno));
  return 126;
}
