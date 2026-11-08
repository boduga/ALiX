/* Fixed-target, read-only privileged qualification helper.
 * Install as root:root 0755 in a root-owned immutable directory.
 * No arguments, environment paths, shell, mutation or process signalling.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/magic.h>
#include <stdio.h>
#include <sys/stat.h>
#include <sys/vfs.h>
#include <unistd.h>

static int inspect(const char *name, int root_fd, int require_events) {
 int fd = name ? openat(root_fd,name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC) : dup(root_fd);
 if(fd<0)return 71;
 struct stat st,ps,es;struct statfs fs;
 if(fstat(fd,&st)||fstatfs(fd,&fs)||fs.f_type!=CGROUP2_SUPER_MAGIC||
    !S_ISDIR(st.st_mode)||st.st_uid!=0||(st.st_mode&0022)){close(fd);return 72;}
 int procs=openat(fd,"cgroup.procs",O_RDONLY|O_NOFOLLOW|O_CLOEXEC);
 int events=openat(fd,"cgroup.events",O_RDONLY|O_NOFOLLOW|O_CLOEXEC);
 int events_errno=errno;
 if(procs<0||(events<0&&(require_events||events_errno!=ENOENT))){
  if(procs>=0)close(procs);
  if(events>=0)close(events);
  close(fd);return 73;
 }
 int ok=!fstat(procs,&ps)&&S_ISREG(ps.st_mode)&&ps.st_uid==0&&ps.st_dev==st.st_dev;
 if(events>=0)ok=ok&&!fstat(events,&es)&&S_ISREG(es.st_mode)&&es.st_uid==0&&es.st_dev==st.st_dev;
 close(procs);if(events>=0)close(events);close(fd);
 return ok?0:74;
}
int main(int argc,char **argv){
 (void)argv;
 if(argc!=1)return 64;
 if(geteuid()!=0)return 65;
 int slash=open("/",O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
 if(slash<0)return 66;
 int sys=openat(slash,"sys",O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);close(slash);
 if(sys<0)return 67;
 int fs=openat(sys,"fs",O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);close(sys);
 if(fs<0)return 68;
 int cgroup=openat(fs,"cgroup",O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);close(fs);
 if(cgroup<0)return 69;
 int result=inspect(NULL,cgroup,0);
 if(!result)result=inspect("user.slice",cgroup,1);
 close(cgroup);
 if(result)return result;
 puts("fixed read-only GE-04 cgroup2 preflight: PASS");return 0;
}
