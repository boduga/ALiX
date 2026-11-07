/* GE-04 R1-B1 Linux native worker launcher prototype.
 * Qualification only. Not a broker transport, not production admission.
 * Deliberately no shell, inherited user environment, or secret descriptors.
 * Must be launched by a trusted privileged supervisor, never by worker input.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <limits.h>
#include <sys/syscall.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

static void die(const char *msg){fprintf(stderr,"GE-04 launcher: %s\n",msg);_exit(125);}
static uid_t uid_arg(const char *s){
 char *end=NULL;errno=0;unsigned long v=strtoul(s,&end,10);
 if(errno||!s[0]||!end||*end||v==0||v>UINT_MAX)die("invalid isolated UID");
 return (uid_t)v;
}
/* An executable supplied by an untrusted directory must never run with
 * privileged launcher authority. Every path component must be root-owned and
 * not writable by group/other. This preflight is NOT race-free pinning. */
static void check_executable_path(const char *path){
 char prefix[PATH_MAX];size_t len=strlen(path);
 if(!len||len>=sizeof(prefix)||path[0]!='/')die("invalid executable path");
 /* Reject dot components, repeated separators and trailing slash. */
 if(len<2||path[len-1]=='/')die("invalid executable path component");
 size_t component=1;
 for(size_t i=1;i<=len;i++){
  if(path[i]!='/' && path[i]!='\0')continue;
  size_t n=i-component;
  if(n==0||(n==1&&path[component]=='.')||
     (n==2&&path[component]=='.'&&path[component+1]=='.'))
    die("invalid executable path component");
  component=i+1;
 }
 for(size_t i=1;i<=len;i++){
  if(path[i]!='/' && path[i]!='\0')continue;
  if(i==1)continue;
  memcpy(prefix,path,i);prefix[i]='\0';
  struct stat st;
  if(lstat(prefix,&st)||st.st_uid!=0||(st.st_mode&0022))die("untrusted executable path component");
  if(i<len && !S_ISDIR(st.st_mode))die("untrusted executable parent");
  if(i==len && (!S_ISREG(st.st_mode)||(st.st_mode&0111)==0))die("untrusted executable file");
 }
}
static void close_inherited_fds(void){
#ifdef SYS_close_range
 if(syscall(SYS_close_range,3U,~0U,0)==0)return;
#endif
 /* A failed close_range must not silently leave high-numbered secret FDs. */
 die("cannot close inherited file descriptors");
}
int main(int argc,char **argv){
 if(argc!=5)die("expected uid, workspace, executable, argument");
 if(geteuid()!=0 || getuid()!=0)die("requires privileged trusted supervisor");
 uid_t target=uid_arg(argv[1]);
 if(target==getuid())die("same UID is forbidden");
 if(argv[2][0]!='/'||argv[3][0]!='/'||strlen(argv[2])>=PATH_MAX||strlen(argv[3])>=PATH_MAX)
   die("absolute workspace and executable required");
 struct stat ws,exe;
 if(lstat(argv[2],&ws)||!S_ISDIR(ws.st_mode)||lstat(argv[3],&exe)||!S_ISREG(exe.st_mode))
   die("workspace or executable not a regular object");
 if((ws.st_mode&0022)||(exe.st_mode&0022))die("untrusted writable path");
 check_executable_path(argv[3]);
 if(chdir(argv[2]))die("workspace inaccessible");
 if(prctl(PR_SET_NO_NEW_PRIVS,1,0,0,0))die("no_new_privs failed");
 if(setgroups(0,NULL)||setresgid((gid_t)target,(gid_t)target,(gid_t)target)||
    setresuid(target,target,target))die("identity isolation failed");
 if(getuid()!=target||geteuid()!=target||getgid()!=(gid_t)target)die("identity mismatch");
 /* Close all inherited FDs except standard streams; stdout/stderr are
  * diagnostic-only and MUST NOT be treated as authenticated peer evidence. */
 close_inherited_fds();
 char *const env[]={"PATH=/usr/bin:/bin","HOME=/nonexistent","LANG=C",NULL};
 char *const args[]={argv[3],argv[4],NULL};
 execve(argv[3],args,env);
 die("worker exec failed");
}
