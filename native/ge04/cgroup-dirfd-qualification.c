/* GE-04 qualification-only descriptor-pinned directory traversal.
 * No cgroup mutation, privilege elevation, or worker admission.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/vfs.h>
#include <linux/magic.h>
#include <unistd.h>

static int fail(const char *message,int fd){
 if(fd>=0)close(fd);
 fprintf(stderr,"cgroup dirfd qualification: %s\n",message);
 return 1;
}
/* Resolve an absolute root without following symlinks in any ancestor.
 * The descriptor, not the input pathname, anchors subsequent operations. */
static int pin_root(const char *path){
 if(!path||path[0]!='/'||path[1]=='\0')return -1;
 size_t len=strlen(path);
 if(len>=PATH_MAX||path[len-1]=='/')return -1;
 int parent=open("/",O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
 if(parent<0)return -1;
 size_t begin=1;
 while(begin<len){
  size_t end=begin;
  while(end<len&&path[end]!='/')end++;
  size_t count=end-begin;
  if(count==0||count>=NAME_MAX||
     (count==1&&path[begin]=='.')||
     (count==2&&path[begin]=='.'&&path[begin+1]=='.')){
   close(parent);return -1;
  }
  char name[NAME_MAX+1];
  memcpy(name,path+begin,count);name[count]='\0';
  int next=openat(parent,name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
  close(parent);
  if(next<0)return -1;
  parent=next;
  begin=end+1;
 }
 return parent;
}
int main(int argc,char **argv){
 if((argc!=3 && argc!=4)||argv[2][0]=='\0'||argv[2][0]=='/'||strchr(argv[2],'/')||
    !strcmp(argv[2],".")||!strcmp(argv[2],".."))return 64;
 int require_cgroup2=argc==4 && strcmp(argv[3],"--require-cgroup2")==0;
 if(argc==4&&!require_cgroup2)return 64;
 int root=pin_root(argv[1]);
 if(root<0)return fail("root open denied",-1);
 struct stat rs,ls;
 if(fstat(root,&rs)||!S_ISDIR(rs.st_mode))return fail("root not directory",root);
 if(require_cgroup2){
  struct statfs fs;
  if(fstatfs(root,&fs)||fs.f_type!=CGROUP2_SUPER_MAGIC||rs.st_uid!=0||
     (rs.st_mode&0022))return fail("untrusted cgroup2 root",root);
 }
 int leaf=openat(root,argv[2],O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
 close(root);
 if(leaf<0)return fail("leaf open denied",-1);
 if(fstat(leaf,&ls)||!S_ISDIR(ls.st_mode))return fail("leaf not directory",leaf);
 if(require_cgroup2){
  struct statfs fs;
  if(fstatfs(leaf,&fs)||fs.f_type!=CGROUP2_SUPER_MAGIC||ls.st_uid!=0||
     (ls.st_mode&0022)||ls.st_dev!=rs.st_dev)
   return fail("untrusted cgroup2 leaf",leaf);
 }
 /* Verify identity from the pinned descriptor, not a later path lookup.
  * Ownership policy is deliberately outside this unprivileged probe. */
 if(ls.st_ino==0||ls.st_dev==0)return fail("invalid inode",leaf);
 for(int i=0;i<3;i++){
  const char *name=i==0?"cgroup.procs":i==1?"cgroup.events":"cgroup.kill";
  int fd=openat(leaf,name,O_RDONLY|O_NOFOLLOW|O_CLOEXEC|O_NONBLOCK);
  if(fd<0)return fail("control open denied",leaf);
  struct stat st;
  if(fstat(fd,&st)||!S_ISREG(st.st_mode)||
     (require_cgroup2&&(st.st_uid!=0||st.st_dev!=ls.st_dev))){
   close(fd);return fail("control not trusted regular file",leaf);
  }
  close(fd);
 }
 close(leaf);
 puts("pinned cgroup directory inspection: PASS");
 return 0;
}
