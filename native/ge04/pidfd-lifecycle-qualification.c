/* GE-04 qualification-only retained-pidfd child lifecycle.
 * Owns and reaps its own forked test child. Never executes worker code,
 * touches cgroups, handles credentials, or admits production workers.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
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
 (void)argv;
 if(argc!=1){fprintf(stderr,"no arguments accepted\n");return 64;}
#ifdef SYS_pidfd_open
 pid_t child=fork();
 if(child<0){perror("fork");return 70;}
 if(child==0){for(;;)pause();}
 /* Child cannot exit voluntarily. The parent owns its lifetime and does
  * not accept an externally supplied PID. The pidfd stays open throughout. */
 int fd=(int)syscall(SYS_pidfd_open,child,0);
 int result=0,status=0;
 if(fd<0){perror("pidfd_open");result=71;goto cleanup;}
 if(!pinned_alive(fd)){result=72;goto cleanup;}
 if(send_pinned(fd,SIGSTOP)<0){perror("stop");result=73;goto cleanup;}
 if(waitpid(child,&status,WUNTRACED)!=child||!WIFSTOPPED(status)||WSTOPSIG(status)!=SIGSTOP){result=74;goto cleanup;}
 if(!pinned_alive(fd)){result=75;goto cleanup;}
 if(send_pinned(fd,SIGCONT)<0){perror("resume");result=76;goto cleanup;}
 if(send_pinned(fd,SIGKILL)<0){perror("kill");result=77;goto cleanup;}
 if(waitpid(child,&status,0)!=child||!WIFSIGNALED(status)||WTERMSIG(status)!=SIGKILL){result=78;goto cleanup;}
 child=-1;
 if(pinned_alive(fd)){result=79;goto cleanup;}
 if(send_pinned(fd,SIGCONT)==0||errno!=ESRCH){result=80;goto cleanup;}
 puts("retained-pidfd lifecycle: PASS");
cleanup:
 if(fd>=0)close(fd);
 if(child>0){kill(child,SIGKILL);while(waitpid(child,&status,0)<0&&errno==EINTR){}}
 return result;
#else
 (void)argv;return 81;
#endif
}
