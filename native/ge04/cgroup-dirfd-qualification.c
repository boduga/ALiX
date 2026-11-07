/* GE-04 qualification-only descriptor-pinned directory traversal.
 * No cgroup mutation, privilege elevation, or worker admission.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static int fail(const char *message,int fd){
 if(fd>=0)close(fd);
 fprintf(stderr,"cgroup dirfd qualification: %s\n",message);
 return 1;
}
int main(int argc,char **argv){
 if(argc!=3||argv[2][0]=='\0'||argv[2][0]=='/'||strchr(argv[2],'/')||
    !strcmp(argv[2],".")||!strcmp(argv[2],".."))return 64;
 int root=open(argv[1],O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
 if(root<0)return fail("root open denied",-1);
 struct stat rs,ls;
 if(fstat(root,&rs)||!S_ISDIR(rs.st_mode))return fail("root not directory",root);
 int leaf=openat(root,argv[2],O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
 close(root);
 if(leaf<0)return fail("leaf open denied",-1);
 if(fstat(leaf,&ls)||!S_ISDIR(ls.st_mode))return fail("leaf not directory",leaf);
 /* Verify identity from the pinned descriptor, not a later path lookup.
  * Ownership policy is deliberately outside this unprivileged probe. */
 if(ls.st_ino==0||ls.st_dev==0)return fail("invalid inode",leaf);
 for(int i=0;i<3;i++){
  const char *name=i==0?"cgroup.procs":i==1?"cgroup.events":"cgroup.kill";
  int fd=openat(leaf,name,O_RDONLY|O_NOFOLLOW|O_CLOEXEC|O_NONBLOCK);
  if(fd<0)return fail("control open denied",leaf);
  struct stat st;
  if(fstat(fd,&st)||!S_ISREG(st.st_mode)){close(fd);return fail("control not regular",leaf);}
  close(fd);
 }
 close(leaf);
 puts("pinned cgroup directory inspection: PASS");
 return 0;
}
