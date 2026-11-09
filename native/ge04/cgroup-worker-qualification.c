/* Closed, credential-free Linux qualification fixture. NOT a supervisor service.
 * No arbitrary path/PID/UID/executable interface, setuid installation or fallback.
 * Cleanup authority is the exact exclusively owned journal-bound cgroup object.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <limits.h>
#include <linux/magic.h>
#include <linux/sched.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/prctl.h>
#include <sys/random.h>
#include <sys/stat.h>
#include <sys/sysmacros.h>
#include <sys/syscall.h>
#include <sys/vfs.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
#include <dirent.h>

#define PARENT "/sys/fs/cgroup/system.slice/ge04-r1b2-qualification.service"
#define WORK "/run/ge04-cgroup-qualification"
#define TEST_UID 20002
struct record {
 char invocation[33], name[24];
 unsigned long long parent_dev, parent_ino, leaf_dev, leaf_ino;
};
struct context {
 int work, lock, parent, leaf, procs, events, killfd, pidfd;
 pid_t child;
 struct stat work_stat, parent_stat, leaf_stat;
 struct record record;
 int owned_leaf, published;
 const char *mode;
 const char *setup_reason;
};
static long long clock_ms(void) {
 struct timespec t;
 if(clock_gettime(CLOCK_MONOTONIC,&t))return -1;
 return (long long)t.tv_sec*1000+t.tv_nsec/1000000;
}
static int same_inode(const struct stat *a,const struct stat *b) {
 return a->st_dev==b->st_dev&&a->st_ino==b->st_ino;
}
static int root_directory(int fd) {
 struct stat s;
 return fd>=0&&!fstat(fd,&s)&&S_ISDIR(s.st_mode)&&s.st_uid==0&&!(s.st_mode&0022);
}
static int pin_directory(const char *path) {
 char copy[PATH_MAX];
 if(!path||path[0]!='/'||strlen(path)>=sizeof(copy))return -1;
 strcpy(copy,path);int fd=open("/",O_RDONLY|O_DIRECTORY|O_CLOEXEC);
 if(!root_directory(fd)){if(fd>=0)close(fd);return -1;}
 char *save=NULL;
 for(char *p=strtok_r(copy+1,"/",&save);p;p=strtok_r(NULL,"/",&save)){
  if(!strcmp(p,".")||!strcmp(p,"..")){close(fd);return -1;}
  int next=openat(fd,p,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);close(fd);fd=next;
  if(!root_directory(fd)){if(fd>=0)close(fd);return -1;}
 }
 return fd;
}
static int regular_root(int fd,mode_t mode,size_t max) {
 struct stat s;
 return fd>=0&&!fstat(fd,&s)&&S_ISREG(s.st_mode)&&s.st_uid==0&&s.st_nlink==1&&
  (s.st_mode&0777)==mode&&s.st_size>=0&&(unsigned long long)s.st_size<=max;
}
static int read_fd(int fd,char *out,size_t cap) {
 if(lseek(fd,0,SEEK_SET)<0)return 0;
 size_t used=0;
 while(used<cap-1){
  ssize_t n=read(fd,out+used,cap-1-used);
  if(n<0){if(errno==EINTR)continue;return 0;}
  if(!n){out[used]=0;return 1;}used+=(size_t)n;
 }
 return 0;
}
static int read_record_file(int dir,const char *name,char *out,size_t cap) {
 int fd=openat(dir,name,O_RDONLY|O_NOFOLLOW|O_CLOEXEC);
 if(!regular_root(fd,0600,cap-1)){if(fd>=0)close(fd);return 0;}
 struct stat st;
 int ok=read_fd(fd,out,cap)&&!fstat(fd,&st)&&(size_t)st.st_size==strlen(out);
 close(fd);return ok;
}
static int hex_string(const char *s,size_t length) {
 return strlen(s)==length&&strspn(s,"0123456789abcdef")==length;
}
static int approval(int dir,struct record *r) {
 char text[257],canonical[257];int used=0;
 if(!read_record_file(dir,"approval.v1",text,sizeof(text)))return 0;
 errno=0;
 if(sscanf(text,"GE04A1 %32s %20llu %20llu\n%n",r->invocation,&r->parent_dev,&r->parent_ino,&used)!=3||
    errno||!hex_string(r->invocation,32)||!r->parent_ino||used!=(int)strlen(text))return 0;
 snprintf(canonical,sizeof(canonical),"GE04A1 %s %llu %llu\n",r->invocation,r->parent_dev,r->parent_ino);
 return !strcmp(text,canonical);
}
static int intent_text(const struct record *r,char *text,size_t cap) {
 int n=snprintf(text,cap,"GE04I1 %s %llu %llu %s %llu %llu\n",r->invocation,
  r->parent_dev,r->parent_ino,r->name,r->leaf_dev,r->leaf_ino);
 return n>0&&(size_t)n<cap;
}
static int read_intent(int dir,const char *name,struct record *r) {
 char text[513],canonical[513];int used=0;
 if(!read_record_file(dir,name,text,sizeof(text)))return 0;
 errno=0;
 if(sscanf(text,"GE04I1 %32s %20llu %20llu %23s %20llu %20llu\n%n",r->invocation,
    &r->parent_dev,&r->parent_ino,r->name,&r->leaf_dev,&r->leaf_ino,&used)!=6||errno||
    used!=(int)strlen(text)||!hex_string(r->invocation,32)||!r->parent_ino||!r->leaf_ino||
    strlen(r->name)!=23||strncmp(r->name,"worker-",7)||!hex_string(r->name+7,16))return 0;
 return intent_text(r,canonical,sizeof(canonical))&&!strcmp(text,canonical);
}
static int records_equal(const struct record *a,const struct record *b) {
 return !strcmp(a->invocation,b->invocation)&&a->parent_dev==b->parent_dev&&a->parent_ino==b->parent_ino&&
  !strcmp(a->name,b->name)&&a->leaf_dev==b->leaf_dev&&a->leaf_ino==b->leaf_ino;
}
static int control(int leaf,const char *name,int flags) {
 int fd=openat(leaf,name,flags|O_NOFOLLOW|O_CLOEXEC);struct stat s,base;struct statfs fs;
 if(fd<0||fstat(fd,&s)||fstat(leaf,&base)||fstatfs(fd,&fs)||fs.f_type!=CGROUP2_SUPER_MAGIC||
    !S_ISREG(s.st_mode)||s.st_uid!=0||(s.st_mode&0022)||s.st_dev!=base.st_dev){if(fd>=0)close(fd);return -1;}
 return fd;
}
static int open_controls(struct context *c) {
 c->procs=control(c->leaf,"cgroup.procs",O_RDWR);
 c->events=control(c->leaf,"cgroup.events",O_RDONLY);
 c->killfd=control(c->leaf,"cgroup.kill",O_WRONLY);
 return c->procs>=0&&c->events>=0&&c->killfd>=0;
}
static int control_custody(int dir,const char *name,int fd,dev_t device) {
 struct stat pinned,named;
 return fd>=0&&!fstat(fd,&pinned)&&!fstatat(dir,name,&named,AT_SYMLINK_NOFOLLOW)&&
  S_ISREG(pinned.st_mode)&&S_ISREG(named.st_mode)&&pinned.st_uid==0&&named.st_uid==0&&
  !(pinned.st_mode&0022)&&!(named.st_mode&0022)&&pinned.st_dev==device&&same_inode(&pinned,&named);
}
static int bindings(struct context *c) {
 struct stat s;struct record a={0};int fd=pin_directory(WORK);
 int ok=fd>=0&&!fstat(fd,&s)&&(s.st_mode&0777)==0700&&same_inode(&s,&c->work_stat);if(fd>=0)close(fd);
 if(!ok||!approval(c->work,&a)||strcmp(a.invocation,c->record.invocation)||
    a.parent_dev!=c->record.parent_dev||a.parent_ino!=c->record.parent_ino)return 0;
 fd=pin_directory(PARENT);ok=fd>=0&&!fstat(fd,&s)&&same_inode(&s,&c->parent_stat);if(fd>=0)close(fd);
 if(!ok||!root_directory(c->leaf)||fstatat(c->parent,c->record.name,&s,AT_SYMLINK_NOFOLLOW)||
    !S_ISDIR(s.st_mode)||s.st_uid!=0||(s.st_mode&0022)||!same_inode(&s,&c->leaf_stat))return 0;
 if(!control_custody(c->leaf,"cgroup.procs",c->procs,c->leaf_stat.st_dev)||
    !control_custody(c->leaf,"cgroup.events",c->events,c->leaf_stat.st_dev)||
    !control_custody(c->leaf,"cgroup.kill",c->killfd,c->leaf_stat.st_dev))return 0;
 if(c->published){struct record r={0};if(!read_intent(c->work,"intent.v1",&r)||!records_equal(&r,&c->record))return 0;}
 return 1;
}
static int members(struct context *c,pid_t *ids,size_t cap) {
 char text[4096],*save=NULL;
 if(!read_fd(c->procs,text,sizeof(text)))return -1;
 size_t count=0;
 for(char *p=strtok_r(text,"\n",&save);p;p=strtok_r(NULL,"\n",&save)){
  char *end=NULL;errno=0;long n=strtol(p,&end,10);
  if(errno||!p[0]||*end||n<=1||n>INT_MAX||count>=cap)return -1;
  ids[count++]=(pid_t)n;
 }
 return (int)count;
}
static int empty(struct context *c) {
 char text[1024],*save=NULL;int found=0,value=-1;pid_t ids[32];
 if(!read_fd(c->events,text,sizeof(text)))return 0;
 for(char *p=strtok_r(text,"\n",&save);p;p=strtok_r(NULL,"\n",&save)){
  if(!strncmp(p,"populated ",10)){if(found++||strlen(p)!=11||(p[10]!='0'&&p[10]!='1'))return 0;value=p[10]-'0';}
 }
 return found==1&&value==0&&members(c,ids,32)==0;
}
static int event(const char *phase) {
 printf("EV %s\n",phase);fflush(stdout);
 struct pollfd p={.fd=0,.events=POLLIN};long long until=clock_ms()+3000;
 for(;;){
  long long now=clock_ms();if(now<0||now>=until)return 0;
  int n=poll(&p,1,(int)(until-now));
  if(n<0&&errno==EINTR)continue;
  if(n<=0||(p.revents&(POLLERR|POLLHUP|POLLNVAL)))return 0;
  unsigned char command;
  return read(0,&command,1)==1&&command=='c';
 }
}
static int write_all(int fd,const char *data,size_t n) {
 size_t offset=0;
 while(offset<n){ssize_t k=write(fd,data+offset,n-offset);if(k<0&&errno==EINTR)continue;if(k<=0)return 0;offset+=(size_t)k;}
 return 1;
}
static int publish(struct context *c) {
 char text[513];if(!intent_text(&c->record,text,sizeof(text)))return 0;
 int fd=openat(c->work,"intent.tmp",O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);
 if(fd<0)return 0;
 int ok=write_all(fd,text,strlen(text))&&!fsync(fd);close(fd);
 if(!ok||!event("TEMP"))return 0;
 if(!strcmp(c->mode,"crash-temp"))_exit(88);
#ifdef SYS_renameat2
 if(syscall(SYS_renameat2,c->work,"intent.tmp",c->work,"intent.v1",RENAME_NOREPLACE))return 0;
#else
 return 0;
#endif
 c->published=1;
 if(!strcmp(c->mode,"fail-publish")){
  errno=0;if(fsync(-1)!=-1||errno!=EBADF)return 0;
  (void)event("PUBLISH_FAILED");return 0;
 }
 return fsync(c->work)==0;
}
static int stat_info(pid_t pid,unsigned long long *ticks,char *state) {
 char path[64],text[16384],*save=NULL;int fd;
 snprintf(path,sizeof(path),"/proc/%ld/stat",(long)pid);fd=open(path,O_RDONLY|O_CLOEXEC|O_NOFOLLOW);
 if(fd<0)return 0;
 int ok=read_fd(fd,text,sizeof(text));close(fd);if(!ok)return 0;
 char prefix[40];snprintf(prefix,sizeof(prefix),"%ld (",(long)pid);
 char *end=strrchr(text,')');if(strncmp(text,prefix,strlen(prefix))||!end||end[1]!=' ')return 0;
 char *p=strtok_r(end+2," \n",&save);if(!p||strlen(p)!=1||strchr("ZXx",p[0]))return 0;*state=p[0];
 for(int i=1;i<=19;i++){p=strtok_r(NULL," \n",&save);if(!p)return 0;}
 char *tail=NULL;errno=0;*ticks=strtoull(p,&tail,10);if(errno||!*ticks||!p[0]||*tail)return 0;
 return 1;
}
static int process_info(pid_t pid,unsigned long long *ticks,char *state,int restricted) {
 if(!stat_info(pid,ticks,state))return 0;
 char path[64],text[16384],*save=NULL;int fd;int ok;
 snprintf(path,sizeof(path),"/proc/%ld/status",(long)pid);fd=open(path,O_RDONLY|O_CLOEXEC|O_NOFOLLOW);
 if(fd<0)return 0;
 ok=read_fd(fd,text,sizeof(text));close(fd);if(!ok)return 0;
 unsigned seen=0;save=NULL;
 for(char *p=strtok_r(text,"\n",&save);p;p=strtok_r(NULL,"\n",&save)){
  if(!strncmp(p,"Uid:",4)||!strncmp(p,"Gid:",4)){
   unsigned a,b,d,e;int n=0;unsigned bit=p[0]=='U'?1:2;
   if((seen&bit)||sscanf(p+4,"%u %u %u %u %n",&a,&b,&d,&e,&n)!=4||p[4+n]||
      a!=(restricted?TEST_UID:0)||b!=(restricted?TEST_UID:0)||d!=(restricted?TEST_UID:0)||e!=(restricted?TEST_UID:0))return 0;
   seen|=bit;
  }else if(restricted&&!strncmp(p,"Groups:",7)){
   if(seen&4)return 0;
   const char *v=p+7;while(*v==' '||*v=='\t')v++;if(*v)return 0;seen|=4;
  }else if(restricted&&!strncmp(p,"NoNewPrivs:",11)){
   if(seen&8)return 0;
   const char *v=p+11;while(*v==' '||*v=='\t')v++;if(strcmp(v,"1"))return 0;seen|=8;
  }else if(restricted){
   const char *labels[]={"CapInh:","CapPrm:","CapEff:","CapAmb:"};
   for(unsigned i=0;i<4;i++)if(!strncmp(p,labels[i],7)){
    unsigned bit=16U<<i;if(seen&bit)return 0;const char *v=p+7;while(*v==' '||*v=='\t')v++;
    if(!*v||strspn(v,"0")!=strlen(v))return 0;
    seen|=bit;
   }
  }
 }
 unsigned long long after;char last_state;
 return seen==(restricted?255U:3U)&&stat_info(pid,&after,&last_state)&&after==*ticks&&
  (restricted||last_state==*state);
}
static int pidfd_alive(int fd) {
 struct pollfd p={.fd=fd,.events=POLLIN};return fd>=0&&poll(&p,1,0)==0;
}
static int wait_stopped(struct context *c,unsigned long long *ticks) {
 long long until=clock_ms()+3000;
 while(1){
  long long now=clock_ms();if(now<0||now>=until)break;
  int status;pid_t got=waitpid(c->child,&status,WNOHANG|WUNTRACED);
  if(got==c->child){char state;return WIFSTOPPED(status)&&WSTOPSIG(status)==SIGSTOP&&
    pidfd_alive(c->pidfd)&&process_info(c->child,ticks,&state,0)&&state=='T';}
  if(got<0)return 0;
  usleep(1000);
 }
 return 0;
}
static void worker(void) {
 /* Close the shared flock open-file description and both controller pipes
  * before stopping. A stopped orphan must neither retain the writer lock nor
  * prevent the controller observing privileged-helper EOF after a crash. */
 int nullfd=open("/dev/null",O_RDWR|O_NOFOLLOW|O_CLOEXEC);struct stat s;
 if(nullfd<0||fstat(nullfd,&s)||!S_ISCHR(s.st_mode)||s.st_uid!=0||s.st_rdev!=makedev(1,3))_exit(125);
 for(int i=0;i<3;i++)if(dup2(nullfd,i)<0)_exit(125);
#ifdef SYS_close_range
 if(syscall(SYS_close_range,3U,~0U,0))_exit(125);
#else
 _exit(125);
#endif
 if(raise(SIGSTOP))_exit(125);
 if(prctl(PR_SET_NO_NEW_PRIVS,1,0,0,0)||setgroups(0,NULL)||
    setresgid(TEST_UID,TEST_UID,TEST_UID)||setresuid(TEST_UID,TEST_UID,TEST_UID))_exit(125);
 pid_t descendant=fork();if(descendant<0)_exit(125);
 if(!descendant&&setsid()<0)_exit(125);
 for(;;)pause();
}
static int wait_running(struct context *c,unsigned long long expected_ticks) {
 long long until=clock_ms()+3000;
 while(1){
  long long now=clock_ms();if(now<0||now>=until)break;
  pid_t ids[32];int n=members(c,ids,32);int ok=n==2;unsigned long long ticks;char state;
  if(n<0)return 0;
  for(int i=0;i<n&&ok;i++)ok=process_info(ids[i],&ticks,&state,1);
  if(ok&&pidfd_alive(c->pidfd)&&process_info(c->child,&ticks,&state,1)&&ticks==expected_ticks)return 1;
  usleep(1000);
 }
 return 0;
}
static int remove_artifact(struct context *c,const char *name) {
 struct stat s;
 if(fstatat(c->work,name,&s,AT_SYMLINK_NOFOLLOW))return errno==ENOENT;
 struct record r={0};if(!read_intent(c->work,name,&r)||!records_equal(&r,&c->record))return 0;
 return unlinkat(c->work,name,0)==0;
}
static int cleanup(struct context *c,int notify) {
 if(!c->owned_leaf)return 1;
 if(!bindings(c))return 0;
 if(c->published){
  if(lseek(c->killfd,0,SEEK_SET)<0||write(c->killfd,"1",1)!=1)return 0;
 }else if(!empty(c))return 0;
 long long until=clock_ms()+3000;int done=0;
 while(1){
  long long now=clock_ms();if(now<0||now>=until)break;
  if(empty(c)){
   if(c->child>0){
    int status;pid_t n;
    while((n=waitpid(-1,&status,WNOHANG))>0){}
    if(n<0&&errno==ECHILD&&(!pidfd_alive(c->pidfd))){done=1;break;}
   }else{done=1;break;}
  }
  usleep(1000);
 }
 if(!done||!bindings(c)||(notify&&!event("EMPTY")))return 0;
 if(!bindings(c)||!empty(c)||unlinkat(c->parent,c->record.name,AT_REMOVEDIR))return 0;
 c->owned_leaf=0;
 if(!remove_artifact(c,"intent.v1")||!remove_artifact(c,"intent.tmp")||fsync(c->work))return 0;
 return 1;
}
static int no_worker_directories(struct context *c) {
 int fd=openat(c->parent,".",O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(fd<0)return 0;
 DIR *dir=fdopendir(fd);if(!dir){close(fd);return 0;}struct dirent *e;int ok=1;
 while((e=readdir(dir))){
  if(!strcmp(e->d_name,".")||!strcmp(e->d_name,"..")||!strcmp(e->d_name,"controller"))continue;
  struct stat s;if(fstatat(c->parent,e->d_name,&s,AT_SYMLINK_NOFOLLOW)||S_ISDIR(s.st_mode)){ok=0;break;}
 }
 closedir(dir);return ok;
}
static int setup(struct context *c) {
 c->work=pin_directory(WORK);
 if(c->work<0||fstat(c->work,&c->work_stat)||(c->work_stat.st_mode&0777)!=0700)return 0;
 c->lock=openat(c->work,".lock",O_RDWR|O_CREAT|O_NOFOLLOW|O_CLOEXEC,0600);
 if(!regular_root(c->lock,0600,0))return 0;
 if(flock(c->lock,LOCK_EX|LOCK_NB)){
  c->setup_reason=(errno==EWOULDBLOCK||errno==EAGAIN)?"LOCK_DENIED":"LOCK_ERROR";
  return 0;
 }
 if(!approval(c->work,&c->record))return 0;
 c->parent=pin_directory(PARENT);struct statfs fs;
 if(c->parent<0||fstat(c->parent,&c->parent_stat)||fstatfs(c->parent,&fs)||fs.f_type!=CGROUP2_SUPER_MAGIC||
    (unsigned long long)c->parent_stat.st_dev!=c->record.parent_dev||
    (unsigned long long)c->parent_stat.st_ino!=c->record.parent_ino)return 0;
 int fd=control(c->parent,"cgroup.procs",O_RDONLY);char text[64];int ok=fd>=0&&read_fd(fd,text,sizeof(text))&&!text[0];if(fd>=0)close(fd);
 return ok;
}
static int open_recorded_leaf(struct context *c) {
 c->leaf=openat(c->parent,c->record.name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
 struct statfs fs;
 if(!root_directory(c->leaf)||fstat(c->leaf,&c->leaf_stat)||fstatfs(c->leaf,&fs)||fs.f_type!=CGROUP2_SUPER_MAGIC||
    c->leaf_stat.st_dev!=c->parent_stat.st_dev||
    (unsigned long long)c->leaf_stat.st_dev!=c->record.leaf_dev||
    (unsigned long long)c->leaf_stat.st_ino!=c->record.leaf_ino||!open_controls(c))return 0;
 c->owned_leaf=1;return bindings(c);
}
static int sweep_empty(struct context *c) {
 struct stat st;
 if(fstatat(c->work,"intent.v1",&st,AT_SYMLINK_NOFOLLOW)==0||errno!=ENOENT)return 0;
 struct record pending={0};
 if(fstatat(c->work,"intent.tmp",&st,AT_SYMLINK_NOFOLLOW)==0){
  if(!read_intent(c->work,"intent.tmp",&pending)||strcmp(pending.invocation,c->record.invocation)||
     pending.parent_dev!=c->record.parent_dev||pending.parent_ino!=c->record.parent_ino)return 0;
  if(fstatat(c->parent,pending.name,&st,AT_SYMLINK_NOFOLLOW)==0){
   if((unsigned long long)st.st_dev!=pending.leaf_dev||(unsigned long long)st.st_ino!=pending.leaf_ino)return 0;
  }else if(errno!=ENOENT)return 0;
 }else if(errno!=ENOENT)return 0;
 int copy=openat(c->parent,".",O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(copy<0)return 0;
 DIR *dir=fdopendir(copy);if(!dir){close(copy);return 0;}struct dirent *e;int ok=1;
 struct record approved=c->record;
 while((e=readdir(dir))){
  if(!strcmp(e->d_name,".")||!strcmp(e->d_name,"..")||!strcmp(e->d_name,"controller"))continue;
  if(fstatat(c->parent,e->d_name,&st,AT_SYMLINK_NOFOLLOW)){ok=0;break;}
  if(!S_ISDIR(st.st_mode))continue;
  if(strlen(e->d_name)!=23||strncmp(e->d_name,"worker-",7)||!hex_string(e->d_name+7,16)){ok=0;break;}
  c->record=approved;strcpy(c->record.name,e->d_name);c->record.leaf_dev=st.st_dev;c->record.leaf_ino=st.st_ino;
  if(!open_recorded_leaf(c)||!empty(c)||!bindings(c)||unlinkat(c->parent,e->d_name,AT_REMOVEDIR)){ok=0;break;}
  c->owned_leaf=0;
  close(c->procs);close(c->events);close(c->killfd);close(c->leaf);c->procs=c->events=c->killfd=c->leaf=-1;
 }
 closedir(dir);
 if(!ok)return 0;
 struct record temp={0};
 if(fstatat(c->work,"intent.tmp",&st,AT_SYMLINK_NOFOLLOW)==0){
  if(!read_intent(c->work,"intent.tmp",&temp)||strcmp(temp.invocation,approved.invocation)||
     temp.parent_dev!=approved.parent_dev||temp.parent_ino!=approved.parent_ino||
     fstatat(c->parent,temp.name,&st,AT_SYMLINK_NOFOLLOW)==0||errno!=ENOENT||unlinkat(c->work,"intent.tmp",0))return 0;
 }else if(errno!=ENOENT)return 0;
 return fsync(c->work)==0;
}
int main(int argc,char **argv) {
 const char *modes[]={"run","fail-before-clone","fail-attach","fail-verify","fail-resume","fail-publish",
  "crash-leaf","crash-temp","crash-intent","crash-child","crash-running","recover","sweep-empty"};
 int valid=0;if(argc==2)for(size_t i=0;i<sizeof(modes)/sizeof(modes[0]);i++)if(!strcmp(argv[1],modes[i]))valid=1;
 if(!valid)return 64;
 if(getuid()!=0||geteuid()!=0)return 77;
 struct context c={.work=-1,.lock=-1,.parent=-1,.leaf=-1,.procs=-1,.events=-1,.killfd=-1,.pidfd=-1,.mode=argv[1]};
 int code=77,clean=0;const char *reason="PRECONDITION";
 if(!setup(&c)){if(c.setup_reason)reason=c.setup_reason;goto finished;}
 if(!strcmp(c.mode,"sweep-empty")){clean=sweep_empty(&c);code=clean?0:77;reason=clean?"EMPTY_SWEEP":"QUARANTINE";goto finished;}
 if(!strcmp(c.mode,"recover")){
  struct record r={0};
  if(!read_intent(c.work,"intent.v1",&r)||strcmp(r.invocation,c.record.invocation)||
     r.parent_dev!=c.record.parent_dev||r.parent_ino!=c.record.parent_ino){reason="INTENT_DENIED";goto finished;}
  c.record=r;c.published=1;
  if(!open_recorded_leaf(&c)){c.owned_leaf=0;reason="BINDING_DENIED";goto finished;}
  clean=cleanup(&c,1);code=clean?0:77;reason=clean?"RECOVERED":"QUARANTINE";goto finished;
 }
 struct stat st;
 if(fstatat(c.work,"intent.v1",&st,AT_SYMLINK_NOFOLLOW)==0||errno!=ENOENT||
    fstatat(c.work,"intent.tmp",&st,AT_SYMLINK_NOFOLLOW)==0||errno!=ENOENT||!no_worker_directories(&c)){
  reason="EXISTING_STATE";goto finished;
 }
 unsigned char random[8];if(getrandom(random,sizeof(random),0)!=(ssize_t)sizeof(random))goto finished;
 strcpy(c.record.name,"worker-");for(int i=0;i<8;i++)snprintf(c.record.name+7+i*2,3,"%02x",random[i]);
 if(mkdirat(c.parent,c.record.name,0700))goto finished;
 c.leaf=openat(c.parent,c.record.name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
 if(!root_directory(c.leaf)||fstat(c.leaf,&c.leaf_stat))goto finished;
 c.record.leaf_dev=c.leaf_stat.st_dev;c.record.leaf_ino=c.leaf_stat.st_ino;c.owned_leaf=1;
 if(!open_controls(&c)||!bindings(&c)||!empty(&c)||!event("LEAF"))goto rollback;
 if(!strcmp(c.mode,"crash-leaf"))_exit(88);
 if(!publish(&c)){reason=!strcmp(c.mode,"fail-publish")?"PUBLISH_EBADF":"PUBLISH_DENIED";goto rollback;}
 if(!event("INTENT"))goto rollback;
 if(!strcmp(c.mode,"crash-intent"))_exit(88);
 if(!strcmp(c.mode,"fail-before-clone")){reason="BEFORE_CLONE";goto rollback;}
 if(!bindings(&c)||!empty(&c)||prctl(PR_SET_CHILD_SUBREAPER,1,0,0,0))goto rollback;
 signal(SIGCHLD,SIG_DFL);
#if defined(SYS_clone3) && defined(CLONE_INTO_CGROUP)
 struct clone_args args={.flags=CLONE_INTO_CGROUP|CLONE_PIDFD,.pidfd=(uintptr_t)&c.pidfd,
  .exit_signal=SIGCHLD,.cgroup=(unsigned)c.leaf};
 c.child=(pid_t)syscall(SYS_clone3,&args,sizeof(args));
 if(c.child==0)worker();
#else
 c.child=-1;errno=ENOSYS;
#endif
 if(c.child<0||c.pidfd<0){reason="CLONE_UNAVAILABLE";goto rollback;}
 if(!event("CHILD"))goto rollback;
 if(!strcmp(c.mode,"crash-child"))_exit(88);
 unsigned long long ticks=0,after=0;char state;
 if(!wait_stopped(&c,&ticks)||!event("STOPPED"))goto rollback;
 if(!strcmp(c.mode,"fail-attach")){
  errno=0;if(write(-1,"0",1)!=-1||errno!=EBADF)reason="INJECTION_FAILED";else reason="ATTACH_EBADF";goto rollback;
 }
 char pid[32];int n=snprintf(pid,sizeof(pid),"%ld",(long)c.child);pid_t ids[32];
 unsigned long long expected_ticks=ticks;
 if(!strcmp(c.mode,"fail-verify"))expected_ticks++;
 if(!bindings(&c)||!pidfd_alive(c.pidfd)||lseek(c.procs,0,SEEK_SET)<0||write(c.procs,pid,(size_t)n)!=n||
    members(&c,ids,32)!=1||ids[0]!=c.child){reason="ATTACHMENT_DENIED";goto rollback;}
 if(!event("READBACK"))goto rollback;
 if(!bindings(&c)||!pidfd_alive(c.pidfd)||!process_info(c.child,&after,&state,0)||state!='T'){
  reason="IDENTITY_DENIED";goto rollback;
 }
 if(after!=expected_ticks){reason=!strcmp(c.mode,"fail-verify")?"VERIFY_MISMATCH":"GENERATION_DENIED";goto rollback;}
 if(!event("ATTACHED")||!bindings(&c)||!pidfd_alive(c.pidfd)||
    !process_info(c.child,&after,&state,0)||state!='T'||after!=ticks)goto rollback;
#ifdef SYS_pidfd_send_signal
 if(!strcmp(c.mode,"fail-resume")){
  errno=0;if(syscall(SYS_pidfd_send_signal,-1,SIGCONT,NULL,0)!=-1||errno!=EBADF)reason="INJECTION_FAILED";else reason="RESUME_EBADF";goto rollback;
 }
 if(syscall(SYS_pidfd_send_signal,c.pidfd,SIGCONT,NULL,0))goto rollback;
#else
 reason="PIDFD_UNAVAILABLE";goto rollback;
#endif
 if(!wait_running(&c,ticks)||!event("RUNNING"))goto rollback;
 if(!strcmp(c.mode,"crash-running"))_exit(88);
 clean=cleanup(&c,1);code=clean?0:77;reason=clean?"COMPLETED":"QUARANTINE";goto finished;
rollback:
 clean=cleanup(&c,1);if(!clean)reason="QUARANTINE";
finished:
 printf("RESULT code=%d reason=%s clean=%d\n",code,reason,clean);fflush(stdout);
 int fds[]={c.pidfd,c.killfd,c.events,c.procs,c.leaf,c.parent,c.lock,c.work};
 for(size_t i=0;i<sizeof(fds)/sizeof(fds[0]);i++)if(fds[i]>=0)close(fds[i]);
 return code;
}
