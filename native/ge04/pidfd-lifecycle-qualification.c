/* GE-04 qualification-only retained-pidfd child lifecycle.
 * Owns and reaps its own forked test child. Never executes worker code,
 * touches cgroups, handles credentials, or admits production workers.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <unistd.h>

static int send_pinned(int fd,int signal_number){
#ifdef SYS_pidfd_send_signal
 return (int)syscall(SYS_pidfd_send_signal,fd,signal_number,NULL,0);
#else
 (void)fd;(void)signal_number;errno=ENOSYS;return -1;
#endif
}
static int pinned_alive(int fd){
 struct pollfd pfd={.fd=fd,.events=POLLIN};
 int result=poll(&pfd,1,0);
 return result==0;
}
int main(int argc,char **argv){
 /* Fixed fault modes are qualification-only; no external PID is accepted. */
 int fail_open=argc==2 && !strcmp(argv[1],"--fail-pidfd-open");
 int fail_before_resume=argc==2 && !strcmp(argv[1],"--fail-before-resume");
 int fail_cleanup_signal=argc==2 && !strcmp(argv[1],"--fail-cleanup-pidfd-signal");
 if(argc!=1 && !fail_open && !fail_before_resume && !fail_cleanup_signal){fprintf(stderr,"invalid arguments\n");return 64;}
#ifdef SYS_pidfd_open
 pid_t child=fork();
 if(child<0){perror("fork");return 70;}
 if(child==0){for(;;)pause();}
 /* Child cannot exit voluntarily. The parent owns its lifetime and does
  * not accept an externally supplied PID. The pidfd stays open throughout. */
 int fd=fail_open?-1:(int)syscall(SYS_pidfd_open,child,0);
 int result=0,status=0;
 if(fd<0){if(!fail_open)perror("pidfd_open");result=71;goto cleanup;}
 if(!pinned_alive(fd)){result=72;goto cleanup;}
 if(send_pinned(fd,SIGSTOP)<0){perror("stop");result=73;goto cleanup;}
 if(waitpid(child,&status,WUNTRACED)!=child||!WIFSTOPPED(status)||WSTOPSIG(status)!=SIGSTOP){result=74;goto cleanup;}
 if(!pinned_alive(fd)){result=75;goto cleanup;}
 if(fail_before_resume||fail_cleanup_signal){result=76;goto cleanup;}
 if(send_pinned(fd,SIGCONT)<0){perror("resume");result=76;goto cleanup;}
 if(send_pinned(fd,SIGKILL)<0){perror("kill");result=77;goto cleanup;}
 if(waitpid(child,&status,0)!=child||!WIFSIGNALED(status)||WTERMSIG(status)!=SIGKILL){result=78;goto cleanup;}
 child=-1;
 if(pinned_alive(fd)){result=79;goto cleanup;}
 if(send_pinned(fd,SIGCONT)==0||errno!=ESRCH){result=80;goto cleanup;}
 puts("retained-pidfd lifecycle: PASS");
cleanup:
 if(child>0){
  /* The direct child is still ours and has not been reaped. Prefer pidfd
   * signaling when available; fallback kill is strictly for this owned child. */
  int signaled=fd>=0 && !fail_cleanup_signal && send_pinned(fd,SIGKILL)==0;
  if(!signaled){
   /* An owned direct child is the only safe PID fallback here. If the
    * pidfd signal failed, never block waiting for a still-running child. */
   if(kill(child,SIGKILL)<0 && errno!=ESRCH)result=82;
   if(fd>=0)result=82;
  }
  pid_t reaped;
  do {reaped=waitpid(child,&status,0);}while(reaped<0&&errno==EINTR);
  if(reaped!=child)result=83;
 }
 if(fd>=0)close(fd);
 return result;
#else
 (void)argv;return 81;
#endif
}
