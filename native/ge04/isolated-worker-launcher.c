/* GE-04 R1-B1 Linux native worker launcher prototype.
 * Qualification only. Not a broker transport, not production admission.
 * Deliberately no shell, inherited user environment, or secret descriptors.
 * Must be launched by a trusted privileged supervisor, never by worker input.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/openat2.h>
#include <grp.h>
#include <limits.h>
#include <sys/syscall.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <signal.h>
#include <sys/types.h>
#include <unistd.h>

static void die(const char *msg){fprintf(stderr,"GE-04 launcher: %s\n",msg);_exit(125);}
static uid_t uid_arg(const char *s){
 char *end=NULL;errno=0;unsigned long v=strtoul(s,&end,10);
 if(errno||!s[0]||!end||*end||v==0||v>UINT_MAX)die("invalid isolated UID");
 return (uid_t)v;
}
/* Pin each ancestor directory before inspecting it. A pathname-only lstat
 * preflight can be raced by rename/symlink substitution; dirfd-relative opens
 * bind the next lookup to the already verified directory inode. */
static void trusted_directory(int fd){
 struct stat st;
 if(fstat(fd,&st)||!S_ISDIR(st.st_mode)||st.st_uid!=0||(st.st_mode&0022))
   die("untrusted executable path component");
}
static int pin_executable(const char *path){
#ifdef SYS_openat2
 size_t len=strlen(path);
 if(len<2||len>=PATH_MAX||path[0]!='/'||path[len-1]=='/')
   die("invalid executable path");
 int parent=open("/",O_PATH|O_DIRECTORY|O_CLOEXEC);
 if(parent<3)die("cannot pin executable root");
 trusted_directory(parent);
 size_t begin=1;
 while(begin<len){
  size_t end=begin;
  while(end<len&&path[end]!='/')end++;
  size_t n=end-begin;
  if(n==0||(n==1&&path[begin]=='.')||
     (n==2&&path[begin]=='.'&&path[begin+1]=='.'))
    die("invalid executable path component");
  char component[PATH_MAX];
  memcpy(component,path+begin,n);component[n]='\0';
  if(end<len){
   struct open_how how={.flags=O_PATH|O_DIRECTORY|O_CLOEXEC,
     .resolve=RESOLVE_BENEATH|RESOLVE_NO_SYMLINKS|RESOLVE_NO_MAGICLINKS};
   int next=(int)syscall(SYS_openat2,parent,component,&how,sizeof(how));
   if(next<3)die("cannot pin executable parent");
   trusted_directory(next);
   close(parent);parent=next;
  }else{
   struct open_how how={.flags=O_RDONLY|O_CLOEXEC,
     .resolve=RESOLVE_BENEATH|RESOLVE_NO_SYMLINKS|RESOLVE_NO_MAGICLINKS};
   int fd=(int)syscall(SYS_openat2,parent,component,&how,sizeof(how));
   if(fd<3)die("cannot pin executable descriptor");
   struct stat st;
   if(fstat(fd,&st)||!S_ISREG(st.st_mode)||st.st_uid!=0||
      (st.st_mode&0022)||(st.st_mode&0111)==0)
     die("untrusted pinned executable");
   close(parent);
   return fd;
  }
  begin=end+1;
 }
 die("invalid executable path");
 return -1;
#else
 (void)path;die("openat2 unavailable");
#endif
}
static void close_inherited_fds(int preserve){
#ifdef SYS_close_range
 if(preserve<3)die("invalid pinned descriptor");
 if(preserve>3 && syscall(SYS_close_range,3U,(unsigned int)preserve-1,0))
   die("cannot close lower inherited descriptors");
 if(syscall(SYS_close_range,(unsigned int)preserve+1,~0U,0)==0)return;
#endif
 /* A failed close_range must not silently leave high-numbered secret FDs. */
 die("cannot close inherited file descriptors");
}
int main(int argc,char **argv){
 if(argc!=5 && argc!=6)die("expected uid, workspace, executable, argument[, stop gate]");
 /* An explicit trusted-supervisor opt-in: the launcher stops itself while
  * still privileged, before any worker UID code can run. The parent MUST
  * independently confirm stopped state, attach to a dedicated cgroup,
  * confirm membership, and only then send SIGCONT. No automatic resume. */
 int stop_gate=(argc==6 && strcmp(argv[5],"--ge04-stop-before-exec")==0);
 if(argc==6 && !stop_gate)die("invalid stop gate");
 if(geteuid()!=0 || getuid()!=0)die("requires privileged trusted supervisor");
 uid_t target=uid_arg(argv[1]);
 if(target==getuid())die("same UID is forbidden");
 if(argv[2][0]!='/'||argv[3][0]!='/'||strlen(argv[2])>=PATH_MAX||strlen(argv[3])>=PATH_MAX)
   die("absolute workspace and executable required");
 struct stat ws;
 if(lstat(argv[2],&ws)||!S_ISDIR(ws.st_mode))
   die("workspace or executable not a regular object");
 if(ws.st_mode&0022)die("untrusted writable path");
 int executable_fd=pin_executable(argv[3]);
 if(chdir(argv[2]))die("workspace inaccessible");
 if(stop_gate){
  /* This is not a full parent-child authentication handshake. It is only
   * the child-side synchronization point; no untrusted code runs yet. */
  if(raise(SIGSTOP)!=0)die("pre-exec stop failed");
 }
 if(prctl(PR_SET_NO_NEW_PRIVS,1,0,0,0))die("no_new_privs failed");
 if(setgroups(0,NULL)||setresgid((gid_t)target,(gid_t)target,(gid_t)target)||
    setresuid(target,target,target))die("identity isolation failed");
 if(getuid()!=target||geteuid()!=target||getgid()!=(gid_t)target)die("identity mismatch");
 /* Close all inherited FDs except standard streams; stdout/stderr are
  * diagnostic-only and MUST NOT be treated as authenticated peer evidence. */
 close_inherited_fds(executable_fd);
 char *const env[]={"PATH=/usr/bin:/bin","HOME=/nonexistent","LANG=C",NULL};
 char *const args[]={argv[3],argv[4],NULL};
 /* Execute the verified open file, not the replaceable pathname. */
#ifdef SYS_execveat
 syscall(SYS_execveat,executable_fd,"",args,env,AT_EMPTY_PATH);
#else
 die("execveat unavailable");
#endif
 die("worker exec failed");
}
