/* GE-04 qualification-only pidfd probe. Not a production supervisor.
 * The pidfd is opened and used in this process, never converted back to
 * kill(pid), but a caller-provided PID is NOT a trusted launch binding.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <limits.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>

static int parse_pid(const char *arg){
 char *end=NULL; errno=0;
 long n=strtol(arg,&end,10);
 if(errno||!arg[0]||!end||*end||n<=1||n>INT_MAX)return -1;
 return (int)n;
}
int main(int argc,char **argv){
 if(argc!=3||(strcmp(argv[1],"alive")&&strcmp(argv[1],"stop")&&
               strcmp(argv[1],"resume")&&strcmp(argv[1],"kill")))return 64;
 int pid=parse_pid(argv[2]);if(pid<0)return 64;
#ifdef SYS_pidfd_open
 int fd=(int)syscall(SYS_pidfd_open,pid,0);
 if(fd<0){perror("pidfd_open");return 70;}
 struct pollfd pfd={.fd=fd,.events=POLLIN};
 int status=poll(&pfd,1,0);
 if(status<0||status>0){close(fd);return 71;}
 int sig=0;
 if(!strcmp(argv[1],"stop"))sig=SIGSTOP;
 else if(!strcmp(argv[1],"resume"))sig=SIGCONT;
 else if(!strcmp(argv[1],"kill"))sig=SIGKILL;
 if(sig){
#ifdef SYS_pidfd_send_signal
  if(syscall(SYS_pidfd_send_signal,fd,sig,NULL,0)<0){perror("pidfd_send_signal");close(fd);return 72;}
#else
  close(fd);return 73;
#endif
 }
 close(fd);return 0;
#else
 (void)pid;return 73;
#endif
}
