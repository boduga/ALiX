/* Read-only cgroup2 root preflight. Never creates cgroups or writes controls. */
#define _GNU_SOURCE
#include <fcntl.h>
#include <limits.h>
#include <linux/magic.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/vfs.h>
#include <unistd.h>

int main(int argc,char **argv){
 if(argc!=2||argv[1][0]!='/'||argv[1][1]=='\0')return 64;
 size_t len=strlen(argv[1]);
 if(len>=PATH_MAX||argv[1][len-1]=='/')return 64;
 int fd=open("/",O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
 if(fd<0)return 70;
 for(size_t begin=1;begin<len;){
  size_t end=begin;
  while(end<len&&argv[1][end]!='/')end++;
  size_t n=end-begin;
  if(!n||n>NAME_MAX||(n==1&&argv[1][begin]=='.')||
     (n==2&&argv[1][begin]=='.'&&argv[1][begin+1]=='.')){
   close(fd);return 71;
  }
  char name[NAME_MAX+1];memcpy(name,argv[1]+begin,n);name[n]='\0';
  int next=openat(fd,name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
  close(fd);if(next<0)return 72;
  fd=next;begin=end+1;
 }
 struct stat st;struct statfs fs;
 if(fstat(fd,&st)||fstatfs(fd,&fs)||!S_ISDIR(st.st_mode)||
    fs.f_type!=CGROUP2_SUPER_MAGIC||st.st_uid!=0||(st.st_mode&0022)){
  close(fd);return 73;
 }
 int procs=openat(fd,"cgroup.procs",O_RDONLY|O_NOFOLLOW|O_CLOEXEC);
 int events=openat(fd,"cgroup.events",O_RDONLY|O_NOFOLLOW|O_CLOEXEC);
 if(procs<0||events<0){
  if(procs>=0)close(procs);
  if(events>=0)close(events);
  close(fd);return 74;
 }
 struct stat ps,es;
 int valid=!fstat(procs,&ps)&&!fstat(events,&es)&&
   S_ISREG(ps.st_mode)&&S_ISREG(es.st_mode)&&
   ps.st_uid==0&&es.st_uid==0&&ps.st_dev==st.st_dev&&es.st_dev==st.st_dev;
 close(procs);close(events);close(fd);
 if(!valid)return 75;
 puts("read-only cgroup2 preflight: PASS");return 0;
}
