/* GE-04 simulated control-FD qualification only. Reject real cgroup mounts.
 * Never send signals or attach processes; only writes to ordinary files.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/magic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/vfs.h>
#include <unistd.h>

int main(int argc,char **argv){
 if(argc!=3||!argv[2][0]||strchr(argv[2],'/')||
    !strcmp(argv[2],".")||!strcmp(argv[2],".."))return 64;
 int parent=open(argv[1],O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
 if(parent<0)return 70;
 struct statfs fs;
 if(fstatfs(parent,&fs)||fs.f_type==CGROUP2_SUPER_MAGIC){close(parent);return 71;}
 int leaf=openat(parent,argv[2],O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
 close(parent);
 if(leaf<0)return 72;
 if(fstatfs(leaf,&fs)||fs.f_type==CGROUP2_SUPER_MAGIC){close(leaf);return 71;}
 int procs=openat(leaf,"cgroup.procs",O_RDWR|O_NOFOLLOW|O_CLOEXEC);
 int events=openat(leaf,"cgroup.events",O_RDONLY|O_NOFOLLOW|O_CLOEXEC);
 int kill=openat(leaf,"cgroup.kill",O_WRONLY|O_NOFOLLOW|O_CLOEXEC);
 if(procs<0||events<0||kill<0){
  if(procs>=0)close(procs);
  if(events>=0)close(events);
  if(kill>=0)close(kill);
  close(leaf);return 73;
 }
 struct stat a,b,c;
 if(fstat(procs,&a)||fstat(events,&b)||fstat(kill,&c)||
    !S_ISREG(a.st_mode)||!S_ISREG(b.st_mode)||!S_ISREG(c.st_mode)){
  close(procs);close(events);close(kill);close(leaf);return 74;
 }
 /* Hold control FDs through a simulated attachment and membership readback.
  * No path is reopened for mutation or verification. */
 const char *pid="424242\n";
 if(ftruncate(procs,0)||write(procs,pid,strlen(pid))!=(ssize_t)strlen(pid)||
    lseek(procs,0,SEEK_SET)<0){
  close(procs);close(events);close(kill);close(leaf);return 75;
 }
 char buf[32]={0};ssize_t n=read(procs,buf,sizeof(buf)-1);
 if(n!=(ssize_t)strlen(pid)||memcmp(buf,pid,strlen(pid))){
  close(procs);close(events);close(kill);close(leaf);return 76;
 }
 /* Keep cgroup.kill pinned but never write it in qualification. */
 close(procs);close(events);close(kill);close(leaf);
 puts("simulated descriptor-relative attach/readback: PASS");return 0;
}
