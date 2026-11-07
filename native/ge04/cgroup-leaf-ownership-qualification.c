/* GE-04 qualification only: exclusive leaf creation under pinned directory.
 * Works on a simulated filesystem; never attaches/kills workers.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <linux/magic.h>
#include <sys/vfs.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static int valid_name(const char *s){
 return s&&*s&&strlen(s)<=NAME_MAX&&strcmp(s,".")&&strcmp(s,"..")&&!strchr(s,'/');
}
/* Pin every ancestor of the selected root, denying symlink traversal. */
static int pin_root(const char *path){
 if(!path||path[0]!='/'||path[1]=='\0')return -1;
 size_t len=strlen(path);
 if(len>=PATH_MAX||path[len-1]=='/')return -1;
 int parent=open("/",O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
 if(parent<0)return -1;
 for(size_t begin=1;begin<len;){
  size_t end=begin;
  while(end<len&&path[end]!='/')end++;
  size_t n=end-begin;
  if(n==0||n>NAME_MAX||(n==1&&path[begin]=='.')||
     (n==2&&path[begin]=='.'&&path[begin+1]=='.')){
   close(parent);return -1;
  }
  char name[NAME_MAX+1];memcpy(name,path+begin,n);name[n]='\0';
  int next=openat(parent,name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
  close(parent);if(next<0)return -1;
  parent=next;begin=end+1;
 }
 return parent;
}
int main(int argc,char **argv){
 if((argc!=3&&argc!=4)||!valid_name(argv[2]))return 64;
 int strict=argc==4&&!strcmp(argv[3],"--require-cgroup2");
 if(argc==4&&!strict)return 64;
 int parent=pin_root(argv[1]);
 if(parent<0)return 70;
 struct stat root_stat;
 if(fstat(parent,&root_stat)||!S_ISDIR(root_stat.st_mode)){
  close(parent);return 70;
 }
 if(strict){
  struct statfs fs;
  if(fstatfs(parent,&fs)||fs.f_type!=CGROUP2_SUPER_MAGIC||
     root_stat.st_uid!=0||(root_stat.st_mode&0022)){
   close(parent);return 76;
  }
 }
 /* mkdirat must fail with EEXIST: never adopt an existing leaf. */
 if(mkdirat(parent,argv[2],0700)){
  int result=errno==EEXIST?73:71;
  close(parent);return result;
 }
 int leaf=openat(parent,argv[2],O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
 if(leaf<0){close(parent);return 72;}
 struct stat st;
 struct statfs leaf_fs;
 if(fstat(leaf,&st)||!S_ISDIR(st.st_mode)||st.st_uid!=geteuid()||
    (st.st_mode&0077)||(strict&&(fstatfs(leaf,&leaf_fs)||
    leaf_fs.f_type!=CGROUP2_SUPER_MAGIC||st.st_dev!=root_stat.st_dev||st.st_uid!=0))){
  close(leaf);close(parent);return 74;
 }
 /* A pinned inode is retained while checking that the directory entry
  * still names it. A rename/replacement denies success. */
 struct stat named;
 if(fstatat(parent,argv[2],&named,AT_SYMLINK_NOFOLLOW)||
    named.st_ino!=st.st_ino||named.st_dev!=st.st_dev){
  close(leaf);close(parent);return 75;
 }
 printf("exclusive leaf created: dev=%llu ino=%llu\n",
   (unsigned long long)st.st_dev,(unsigned long long)st.st_ino);
 close(leaf);close(parent);
 return 0;
}
