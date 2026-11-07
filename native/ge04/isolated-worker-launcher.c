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
 if(chdir(argv[2]))die("workspace inaccessible");
 if(prctl(PR_SET_NO_NEW_PRIVS,1,0,0,0))die("no_new_privs failed");
 if(setgroups(0,NULL)||setresgid((gid_t)target,(gid_t)target,(gid_t)target)||
    setresuid(target,target,target))die("identity isolation failed");
 if(getuid()!=target||geteuid()!=target||getgid()!=(gid_t)target)die("identity mismatch");
 /* Close all inherited FDs except standard streams; stdout/stderr are
  * diagnostic-only and MUST NOT be treated as authenticated peer evidence. */
 for(int fd=3;fd<1024;fd++)close(fd);
 char *const env[]={"PATH=/usr/bin:/bin","HOME=/nonexistent","LANG=C",NULL};
 char *const args[]={argv[3],argv[4],NULL};
 execve(argv[3],args,env);
 die("worker exec failed");
}
