/* GE-04 qualification only: exclusive leaf creation under pinned directory.
 * Works on a simulated filesystem; never attaches/kills workers.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static int valid_name(const char *s){
 return s&&*s&&strcmp(s,".")&&strcmp(s,"..")&&!strchr(s,'/');
}
int main(int argc,char **argv){
 if(argc!=3||!valid_name(argv[2]))return 64;
 int parent=open(argv[1],O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
 if(parent<0)return 70;
 /* mkdirat must fail with EEXIST: never adopt an existing leaf. */
 if(mkdirat(parent,argv[2],0700)){
  int result=errno==EEXIST?73:71;
  close(parent);return result;
 }
 int leaf=openat(parent,argv[2],O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
 if(leaf<0){close(parent);return 72;}
 struct stat st;
 if(fstat(leaf,&st)||!S_ISDIR(st.st_mode)||st.st_uid!=geteuid()||
    (st.st_mode&0077)){
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
