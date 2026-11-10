/* Closed root-only namespace bootstrap fixture. No runtime/image/user exec.
 * Authority: exact approval/journal-bound, exclusively owned cgroup subtree.
 * Diagnostic phases are not attestation. SECURITY HOLD remains active.
 */
#define _GNU_SOURCE
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <linux/magic.h>
#include <linux/nsfs.h>
#include <linux/sched.h>
#include <poll.h>
#include <sched.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/ioctl.h>
#include <sys/mount.h>
#include <sys/prctl.h>
#include <sys/random.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/sysmacros.h>
#include <sys/vfs.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#define PARENT "/sys/fs/cgroup/system.slice/ge04-r1b2-view-qualification.service"
#define WORK "/run/ge04-view-qualification"
#define BUDGET 3000
struct record {
 char invocation[33],name[24];
 unsigned long long parent_dev,parent_ino,outer_dev,outer_ino;
};
struct context {
 int work,lock,parent,outer,launcher,payload,procs,events,killfd;
 int pidfd[2],ns[2],view[2];
 pid_t child[2];
 unsigned long long ticks[2];
 struct stat work_stat,lock_stat,parent_stat,outer_stat,inner_stat[2],ns_stat[2];
 struct record record;
 unsigned ack_sequence;
 int owned,published;
 const char *mode,*reason;
};
static int limits(struct context *c);
static int controllers(int dir,int enabled);
static int inner_custody(struct context *c,const char *name,int fd,const struct stat *saved);
/* Single-threaded closed helper: nested I/O shares this absolute operation
 * deadline. Forked children perform only their fixed bootstrap syscalls. */
static long long active_until;
static long long clock_ms(void) {
 struct timespec t;
 if(clock_gettime(CLOCK_MONOTONIC,&t))return -1;
 return (long long)t.tv_sec*1000+t.tv_nsec/1000000;
}
static long long begin_operation(void) {
 long long now=clock_ms();
 active_until=now<0?0:now+BUDGET;
 return active_until;
}
static int budget_ok(void) {
 long long now=clock_ms();
 return now>=0&&active_until>now;
}
static int same_inode(const struct stat *a,const struct stat *b) {
 return a->st_dev==b->st_dev&&a->st_ino==b->st_ino;
}
static int root_directory(int fd,int exact) {
 struct stat s;
 return budget_ok()&&fd>=0&&!fstat(fd,&s)&&S_ISDIR(s.st_mode)&&s.st_uid==0&&s.st_gid==0&&
  !(s.st_mode&0022)&&(!exact||(s.st_mode&07777)==0700);
}
static int pin_directory(const char *path) {
 char copy[PATH_MAX];
 if(!budget_ok()||!path||path[0]!='/'||strlen(path)>=sizeof(copy))return -1;
 strcpy(copy,path);int fd=open("/",O_RDONLY|O_DIRECTORY|O_CLOEXEC);
 if(!root_directory(fd,0)){if(fd>=0)close(fd);return -1;}
 char *save=NULL;
 for(char *p=strtok_r(copy+1,"/",&save);p;p=strtok_r(NULL,"/",&save)){
  if(!budget_ok()){close(fd);return -1;}
  if(!strcmp(p,".")||!strcmp(p,"..")){close(fd);return -1;}
  int next=openat(fd,p,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);close(fd);fd=next;
  if(!root_directory(fd,0)){if(fd>=0)close(fd);return -1;}
 }
 return fd;
}
static int regular_root(int fd,mode_t mode,size_t max) {
 struct stat s;
 return budget_ok()&&fd>=0&&!fstat(fd,&s)&&S_ISREG(s.st_mode)&&s.st_uid==0&&s.st_gid==0&&
  s.st_nlink==1&&(s.st_mode&07777)==mode&&s.st_size>=0&&(unsigned long long)s.st_size<=max;
}
static int read_fd(int fd,char *out,size_t cap) {
 if(!budget_ok()||lseek(fd,0,SEEK_SET)<0)return 0;
 size_t used=0;
 while(used<cap-1){
  if(!budget_ok())return 0;
  ssize_t n=read(fd,out+used,cap-1-used);
  if(n<0){if(errno==EINTR)continue;return 0;}
  if(!n){out[used]=0;return budget_ok();}used+=(size_t)n;
 }
 return 0;
}
static int open_regular(int dir,const char *name,int flags,mode_t mode,size_t max,int create) {
 if(!budget_ok())return -1;
 if(create){
  int fresh=openat(dir,name,flags|O_CREAT|O_EXCL|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC,mode);
  if(fresh>=0){
   if(regular_root(fresh,mode,max))return fresh;
   close(fresh);return -1;
  }
  if(errno!=EEXIST)return -1;
 }
 /* O_PATH inspects an unexpected FIFO/device without opening its driver.
  * The actual regular-file open remains nonblocking and inode-matched. */
 int metadata=openat(dir,name,O_PATH|O_NOFOLLOW|O_CLOEXEC);struct stat before,after;
 if(!regular_root(metadata,mode,max)||fstat(metadata,&before)){
  if(metadata>=0)close(metadata);
  return -1;
 }
 int fd=budget_ok()?openat(dir,name,flags|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC):-1;
 int ok=regular_root(fd,mode,max)&&!fstat(fd,&after)&&same_inode(&before,&after);
 close(metadata);
 if(!ok){if(fd>=0)close(fd);return -1;}
 return fd;
}
static int read_record(int dir,const char *name,char *out,size_t cap) {
 int fd=open_regular(dir,name,O_RDONLY,0600,cap-1,0);
 if(fd<0)return 0;
 struct stat s;
 int ok=read_fd(fd,out,cap)&&!fstat(fd,&s)&&(size_t)s.st_size==strlen(out);
 close(fd);return ok;
}
static int hex_string(const char *s,size_t length) {
 return strlen(s)==length&&strspn(s,"0123456789abcdef")==length;
}
static int approval(int dir,struct record *r) {
 char text[257],canonical[257];int used=0;
 if(!read_record(dir,"approval.v1",text,sizeof(text)))return 0;
 errno=0;
 if(sscanf(text,"GE04VA1 %32s %20llu %20llu\n%n",r->invocation,&r->parent_dev,&r->parent_ino,&used)!=3||
    errno||!hex_string(r->invocation,32)||!r->parent_ino||used!=(int)strlen(text))return 0;
 snprintf(canonical,sizeof(canonical),"GE04VA1 %s %llu %llu\n",r->invocation,r->parent_dev,r->parent_ino);
 return !strcmp(text,canonical);
}
static int intent_text(const struct record *r,char *out,size_t cap) {
 int n=snprintf(out,cap,"GE04VI1 %s %llu %llu %s %llu %llu\n",r->invocation,r->parent_dev,
  r->parent_ino,r->name,r->outer_dev,r->outer_ino);
 return n>0&&(size_t)n<cap;
}
static int intent(int dir,const char *name,struct record *r) {
 char text[513],canonical[513];int used=0;
 if(!read_record(dir,name,text,sizeof(text)))return 0;
 errno=0;
 if(sscanf(text,"GE04VI1 %32s %20llu %20llu %23s %20llu %20llu\n%n",r->invocation,
    &r->parent_dev,&r->parent_ino,r->name,&r->outer_dev,&r->outer_ino,&used)!=6||errno||
    used!=(int)strlen(text)||!hex_string(r->invocation,32)||!r->parent_ino||!r->outer_ino||
    strlen(r->name)!=23||strncmp(r->name,"worker-",7)||!hex_string(r->name+7,16))return 0;
 return intent_text(r,canonical,sizeof(canonical))&&!strcmp(text,canonical);
}
static int records_equal(const struct record *a,const struct record *b) {
 return !strcmp(a->invocation,b->invocation)&&a->parent_dev==b->parent_dev&&a->parent_ino==b->parent_ino&&
  !strcmp(a->name,b->name)&&a->outer_dev==b->outer_dev&&a->outer_ino==b->outer_ino;
}
static int control(int dir,const char *name,int flags) {
 if(!budget_ok())return -1;
 int fd=openat(dir,name,flags|O_NOFOLLOW|O_CLOEXEC);struct stat s,base;struct statfs fs;
 if(fd<0)return -1;
 if(!budget_ok()||fstat(fd,&s)||fstat(dir,&base)||fstatfs(fd,&fs)||fs.f_type!=CGROUP2_SUPER_MAGIC||
    !S_ISREG(s.st_mode)||s.st_uid||s.st_gid||(s.st_mode&0022)||s.st_dev!=base.st_dev){close(fd);return -1;}
 return fd;
}
static int control_custody(int dir,const char *name,int fd) {
 struct stat a,b;struct statfs fs;
 return budget_ok()&&fd>=0&&!fstat(fd,&a)&&!fstatat(dir,name,&b,AT_SYMLINK_NOFOLLOW)&&same_inode(&a,&b)&&
  S_ISREG(b.st_mode)&&!b.st_uid&&!b.st_gid&&!(b.st_mode&0022)&&!fstatfs(fd,&fs)&&fs.f_type==CGROUP2_SUPER_MAGIC;
}
static int text_is(int dir,const char *name,const char *expected) {
 char text[4097];int fd=control(dir,name,O_RDONLY);if(fd<0)return 0;
 int ok=read_fd(fd,text,sizeof(text))&&!strcmp(text,expected);close(fd);return ok;
}
static int set_text(int dir,const char *name,const char *text) {
 int fd=control(dir,name,O_WRONLY);if(fd<0)return 0;
 size_t n=strlen(text);ssize_t written=-1;
 do{
  if(!budget_ok())break;
  written=write(fd,text,n);
 }while(written<0&&errno==EINTR);
 int ok=written==(ssize_t)n&&control_custody(dir,name,fd)&&budget_ok();close(fd);return ok;
}
static int members(int dir,pid_t *ids,size_t cap) {
 char text[4097];int fd=control(dir,"cgroup.procs",O_RDONLY);
 if(fd<0)return -1;
 int ok=read_fd(fd,text,sizeof(text));close(fd);if(!ok)return -1;
 char *p=text,*end;size_t n=0;
 while(*p){
  errno=0;long value=strtol(p,&end,10);
  if(errno||end==p||value<1||value>INT_MAX||(*end!='\n'&&*end)||n>=cap)return -1;
  ids[n++]=(pid_t)value;p=end;if(*p=='\n')p++;
 }
 return (int)n;
}
static int empty(int dir) {
 pid_t ids[128];char text[4097];int fd=control(dir,"cgroup.events",O_RDONLY);
 if(fd<0)return 0;
 int ok=read_fd(fd,text,sizeof(text));close(fd);
 return ok&&(strstr(text,"populated 0\n")==text||strstr(text,"\npopulated 0\n"))&&members(dir,ids,128)==0;
}
static int bindings(struct context *c) {
 if(!budget_ok())return 0;
 struct stat s;struct record approved={0},recorded={0};
 int work=pin_directory(WORK),parent=pin_directory(PARENT);int ok=0;
 if(!root_directory(work,1)||!root_directory(parent,0)||fstat(work,&s)||!same_inode(&s,&c->work_stat))goto out;
 if(fstat(parent,&s)||!same_inode(&s,&c->parent_stat)||
    fstatat(work,".lock",&s,AT_SYMLINK_NOFOLLOW)||!same_inode(&s,&c->lock_stat)||
    !regular_root(c->lock,0600,0)||!approval(work,&approved)||
    strcmp(approved.invocation,c->record.invocation)||approved.parent_dev!=c->record.parent_dev||
    approved.parent_ino!=c->record.parent_ino)goto out;
 if(c->owned){
  if(!root_directory(c->outer,1)||fstatat(parent,c->record.name,&s,AT_SYMLINK_NOFOLLOW)||
     !same_inode(&s,&c->outer_stat)||(s.st_mode&07777)!=0700||s.st_uid||s.st_gid||
     !control_custody(c->outer,"cgroup.procs",c->procs)||
     !control_custody(c->outer,"cgroup.events",c->events)||
     !control_custody(c->outer,"cgroup.kill",c->killfd))goto out;
 }
 if(c->published&&(!intent(work,"intent.v1",&recorded)||!records_equal(&recorded,&c->record)))goto out;
 ok=1;
out:
 if(work>=0)close(work);
 if(parent>=0)close(parent);
 return ok&&budget_ok();
}
static int ack_phase(const char *phase) {
 const char *allowed[]={"INTENT","PRE_NAMESPACE","PINNED","ENABLED","PRE_JOIN","READY","EMPTY","DENIED"};
 for(size_t i=0;i<sizeof(allowed)/sizeof(allowed[0]);i++)if(!strcmp(phase,allowed[i]))return 1;
 return 0;
}
/* This is exact frame/ordering integrity, NOT sender authentication.
 * Any holder of stdin can still forge a correctly formatted ACK. Only the
 * separately protected original observer may eventually own this channel. */
static int ack_exact(struct context *c,const char *phase,long long until) {
 char expected[128];
 if(!ack_phase(phase)||!hex_string(c->record.invocation,32)||c->ack_sequence>=8)return 0;
 unsigned next=c->ack_sequence+1;
 int count=snprintf(expected,sizeof(expected),"GE04ACK1 %s %s %u\n",
                    c->record.invocation,phase,next);
 if(count<=0||(size_t)count>=sizeof(expected))return 0;
 for(int i=0;i<count;i++){
  long long now=clock_ms();if(now<0||now>=until)return 0;
  struct pollfd p={.fd=STDIN_FILENO,.events=POLLIN};
  int n;
  do{n=poll(&p,1,(int)(until-now));}while(n<0&&errno==EINTR&&budget_ok());
  if(n!=1||!(p.revents&POLLIN)||(p.revents&(POLLERR|POLLNVAL)))return 0;
  char received;ssize_t used;
  do{used=read(STDIN_FILENO,&received,1);}while(used<0&&errno==EINTR&&budget_ok());
  if(used!=1||received!=expected[i])return 0;
 }
 struct pollfd extra={.fd=STDIN_FILENO,.events=POLLIN};int n;
 do{n=poll(&extra,1,0);}while(n<0&&errno==EINTR&&budget_ok());
 if(n!=0||!budget_ok())return 0;
 c->ack_sequence=next;
 return 1;
}
static int event_until(struct context *c,const char *phase,long long until) {
 active_until=until;
 if(!budget_ok()||!ack_phase(phase)||!hex_string(c->record.invocation,32))return 0;
 /* Phase stdout remains a diagnostic hint, never authorization. */
 pid_t a=c->child[0]>1&&c->ticks[0]?c->child[0]:0;
 pid_t b=c->child[1]>1&&c->ticks[1]?c->child[1]:0;
 printf("EV %s %ld %llu %ld %llu\n",phase,(long)a,a?c->ticks[0]:0,(long)b,b?c->ticks[1]:0);
 if(fflush(stdout))return 0;
 return ack_exact(c,phase,until);
}
static int event(struct context *c,const char *phase) {
 int ok=event_until(c,phase,begin_operation());
 if(ok)begin_operation();
 return ok;
}
static int write_all(int fd,const char *data,size_t n) {
 size_t off=0;
 while(off<n){
  if(!budget_ok())return 0;
  ssize_t used=write(fd,data+off,n-off);if(used<0&&errno==EINTR)continue;
  if(used<=0)return 0;
  off+=(size_t)used;
 }
 return budget_ok();
}
static int publish(struct context *c) {
 char text[513];if(!bindings(c)||!intent_text(&c->record,text,sizeof(text)))return 0;
 int fd=openat(c->work,"intent.tmp",O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);
 if(!regular_root(fd,0600,sizeof(text)-1)){if(fd>=0)close(fd);return 0;}
 int ok=write_all(fd,text,strlen(text))&&budget_ok()&&!fsync(fd)&&budget_ok();close(fd);if(!ok)return 0;
#ifdef SYS_renameat2
 if(!budget_ok()||syscall(SYS_renameat2,c->work,"intent.tmp",c->work,"intent.v1",RENAME_NOREPLACE))return 0;
#else
 return 0;
#endif
 c->published=1;return budget_ok()&&fsync(c->work)==0&&bindings(c);
}
static int process_info(pid_t pid,unsigned long long *ticks,char *state) {
 if(!budget_ok())return 0;
 char path[80],text[16385];snprintf(path,sizeof(path),"/proc/%ld/stat",(long)pid);
 int fd=open(path,O_RDONLY|O_CLOEXEC|O_NOFOLLOW|O_NONBLOCK);if(fd<0)return 0;
 struct statfs fs;int ok=!fstatfs(fd,&fs)&&fs.f_type==PROC_SUPER_MAGIC&&read_fd(fd,text,sizeof(text));
 close(fd);if(!ok)return 0;
 char *p=strrchr(text,')');if(!p||p[1]!=' '||!p[2]||p[3]!=' ')return 0;
 *state=p[2];p+=4;
 for(int field=4;field<22;field++){char *end=strchr(p,' ');if(!end)return 0;p=end+1;}
 errno=0;char *end;*ticks=strtoull(p,&end,10);if(errno||end==p||!*ticks||(*end!=' '&&*end))return 0;
 snprintf(path,sizeof(path),"/proc/%ld/status",(long)pid);
 if(!budget_ok())return 0;
 fd=open(path,O_RDONLY|O_CLOEXEC|O_NOFOLLOW|O_NONBLOCK);if(fd<0)return 0;
 ok=!fstatfs(fd,&fs)&&fs.f_type==PROC_SUPER_MAGIC&&read_fd(fd,text,sizeof(text));
 close(fd);if(!ok)return 0;
 unsigned a,b,d,e;char *uid=strstr(text,"\nUid:"),*gid=strstr(text,"\nGid:");
 if(!uid||!gid||sscanf(uid,"\nUid:\t%u\t%u\t%u\t%u",&a,&b,&d,&e)!=4||a||b||d||e)return 0;
 return sscanf(gid,"\nGid:\t%u\t%u\t%u\t%u",&a,&b,&d,&e)==4&&!a&&!b&&!d&&!e;
}
static int pidfd_state(int fd) {
 if(fd<0||!budget_ok())return -1;
 struct pollfd p={.fd=fd,.events=POLLIN};
 int n;
 do{n=poll(&p,1,0);}while(n<0&&errno==EINTR&&budget_ok());
 if(n<0||!budget_ok()||(p.revents&(POLLERR|POLLNVAL)))return -1;
 if(!n)return 0;
 return p.revents&(POLLIN|POLLHUP)?1:-1;
}
static int pidfd_alive(int fd) {
 return pidfd_state(fd)==0;
}
static int stopped(struct context *c,int slot,int dir) {
 unsigned long long ticks;char state;pid_t ids[128];
 int n=members(dir,ids,128),member=0;
 if(n<0)return 0;
 for(int i=0;i<n;i++)if(ids[i]==c->child[slot])member=1;
 return member&&pidfd_alive(c->pidfd[slot])&&process_info(c->child[slot],&ticks,&state)&&state=='T'&&
  (!c->ticks[slot]||c->ticks[slot]==ticks)&&(slot!=0||n==1);
}
static int namespace_stat(pid_t pid,const char *kind,struct stat *s) {
 char path[80];snprintf(path,sizeof(path),"/proc/%ld/ns/%s",(long)pid,kind);
 return budget_ok()&&stat(path,s)==0&&budget_ok();
}
static int wait_stop(struct context *c,int slot,int migrated) {
 long long until=begin_operation();
 for(;;){
  long long now=clock_ms();if(now<0||now>=until)return 0;
  int status;pid_t got=waitpid(c->child[slot],&status,WNOHANG|WUNTRACED);
  if(got<0&&errno!=EINTR)return 0;
  if(got==c->child[slot]&&(WIFEXITED(status)||WIFSIGNALED(status)))return 0;
  int dir=slot==0&&!migrated?c->outer:c->launcher;
  unsigned long long ticks;char state;
  if(stopped(c,slot,dir)&&process_info(c->child[slot],&ticks,&state)){
   if(migrated){
    struct stat mnt,cg;
    if(!namespace_stat(c->child[slot],"mnt",&mnt)||!namespace_stat(c->child[slot],"cgroup",&cg))return 0;
    struct stat own_mnt,own_cg;
    if(!namespace_stat(getpid(),"mnt",&own_mnt)||!namespace_stat(getpid(),"cgroup",&own_cg))return 0;
    if(same_inode(&mnt,&own_mnt)||same_inode(&cg,&own_cg)){usleep(1000);continue;}
    if(slot==1&&(!same_inode(&mnt,&c->ns_stat[0])||!same_inode(&cg,&c->ns_stat[1])))return 0;
   }
   c->ticks[slot]=ticks;return 1;
  }
  usleep(1000);
 }
}
static int continue_child(struct context *c,int slot) {
 begin_operation();
 unsigned long long ticks;char state;
 if(!bindings(c)||!pidfd_alive(c->pidfd[slot])||!process_info(c->child[slot],&ticks,&state)||
    state!='T'||ticks!=c->ticks[slot]||
    !inner_custody(c,"launcher",c->launcher,&c->inner_stat[0])||
    !inner_custody(c,"payload",c->payload,&c->inner_stat[1])||
    !stopped(c,slot,slot==0?c->outer:c->launcher))return 0;
#ifdef SYS_pidfd_send_signal
 return syscall(SYS_pidfd_send_signal,c->pidfd[slot],SIGCONT,NULL,0)==0;
#else
 return 0;
#endif
}
static void child_setup(pid_t parent,int nullfd,int first,int second) {
 if(prctl(PR_SET_PDEATHSIG,SIGKILL,0,0,0)||getppid()!=parent)_exit(119);
 struct stat s;
 if(fstat(nullfd,&s)||!S_ISCHR(s.st_mode)||s.st_rdev!=makedev(1,3)||
    dup3(nullfd,0,0)<0||dup3(nullfd,1,0)<0||dup3(nullfd,2,0)<0||
    dup3(first,3,O_CLOEXEC)<0||(second>=0&&dup3(second,4,O_CLOEXEC)<0))_exit(119);
#ifdef SYS_close_range
 if(syscall(SYS_close_range,second>=0?5U:4U,~0U,0))_exit(119);
#else
 _exit(119);
#endif
 struct rlimit files={128,128},core={0,0},size={1048576,1048576};
 if(setrlimit(RLIMIT_NOFILE,&files)||setrlimit(RLIMIT_CORE,&core)||setrlimit(RLIMIT_FSIZE,&size))_exit(119);
 if(raise(SIGSTOP))_exit(124);
}
static void bootstrap_child(pid_t parent,int nullfd,int launcher,const char *mode) {
 child_setup(parent,nullfd,launcher,-1);
 if(unshare(CLONE_NEWNS|CLONE_NEWCGROUP))_exit(120);
 if(mount(NULL,"/",NULL,MS_REC|MS_PRIVATE,NULL))_exit(121);
 if(!strcmp(mode,"fail-mount"))_exit(122);
 if(mount("none","/sys/fs/cgroup","cgroup2",MS_NOSUID|MS_NODEV|MS_NOEXEC,NULL))_exit(123);
 if(write(3,"0",1)!=1)_exit(124);
 close(3);
 if(raise(SIGSTOP))_exit(124);
 for(;;)pause();
}
static void join_child(pid_t parent,int nullfd,int mnt,int cg) {
 child_setup(parent,nullfd,mnt,cg);
 if(setns(4,CLONE_NEWCGROUP)||setns(3,CLONE_NEWNS))_exit(126);
 close(3);close(4);
 if(raise(SIGSTOP))_exit(126);
 for(;;)pause();
}
static int spawn_child(struct context *c,int slot) {
 begin_operation();
 if(!bindings(c)||!limits(c)||!controllers(c->outer,slot!=0)||
    !text_is(c->outer,"cgroup.type","domain\n")||
    !inner_custody(c,"launcher",c->launcher,&c->inner_stat[0])||
    !inner_custody(c,"payload",c->payload,&c->inner_stat[1])||
    !controllers(c->launcher,0)||!controllers(c->payload,0)||
    (slot==1&&!text_is(c->launcher,"pids.max","64\n")))return 0;
 int nullfd=open("/dev/null",O_RDWR|O_NOFOLLOW|O_CLOEXEC|O_NOCTTY);struct stat s;
 if(nullfd<0)return 0;
 if(fstat(nullfd,&s)||!S_ISCHR(s.st_mode)||s.st_uid||s.st_gid||s.st_rdev!=makedev(1,3)){close(nullfd);return 0;}
 int source=slot==0?control(c->launcher,"cgroup.procs",O_WRONLY):c->ns[0];
 if(source<0){close(nullfd);return 0;}
 int high[3]={-1,-1,-1};high[0]=fcntl(nullfd,F_DUPFD_CLOEXEC,16);
 high[1]=fcntl(source,F_DUPFD_CLOEXEC,16);
 if(slot==1)high[2]=fcntl(c->ns[1],F_DUPFD_CLOEXEC,16);
 close(nullfd);if(slot==0)close(source);
 int valid=high[0]>=16&&high[1]>=16&&high[0]!=high[1]&&
  (slot==0||(high[2]>=16&&high[2]!=high[0]&&high[2]!=high[1]));
 if(!valid){for(int i=0;i<3;i++)if(high[i]>=0)close(high[i]);return 0;}
 pid_t parent=getpid();
 if(!budget_ok()){for(int i=0;i<3;i++)if(high[i]>=0)close(high[i]);return 0;}
#if defined(SYS_clone3) && defined(CLONE_INTO_CGROUP)
 struct clone_args args={.flags=CLONE_INTO_CGROUP|CLONE_PIDFD,.pidfd=(uintptr_t)&c->pidfd[slot],
  .exit_signal=SIGCHLD,.cgroup=(unsigned)(slot==0?c->outer:c->launcher)};
 c->child[slot]=(pid_t)syscall(SYS_clone3,&args,sizeof(args));
 if(!c->child[slot]){
  if(slot==0)bootstrap_child(parent,high[0],high[1],c->mode);
  else join_child(parent,high[0],high[1],high[2]);
  _exit(127);
 }
#else
 c->child[slot]=-1;errno=ENOSYS;
#endif
 for(int i=0;i<3;i++)if(high[i]>=0)close(high[i]);
 if(c->child[slot]<0){c->child[slot]=0;c->ticks[slot]=0;}
 return c->child[slot]>0&&c->pidfd[slot]>=0;
}
static int open_view(struct context *c,int slot) {
 if(!budget_ok())return 0;
 char path[96];snprintf(path,sizeof(path),"/proc/%ld/root/sys/fs/cgroup",(long)c->child[slot]);
 /* Only our generated, stopped, generation-pinned trusted child may supply this
  * kernel proc root magiclink. No caller-supplied PID/path or worker report. */
 int fd=open(path,O_RDONLY|O_DIRECTORY|O_CLOEXEC);struct stat s;struct statfs fs;
 if(fd<0)return 0;
 if(fstat(fd,&s)||fstatfs(fd,&fs)||fs.f_type!=CGROUP2_SUPER_MAGIC||!same_inode(&s,&c->outer_stat)){
  close(fd);return 0;
 }
 c->view[slot]=fd;return 1;
}
static int pin_view(struct context *c) {
 if(!bindings(c)||!stopped(c,0,c->launcher))return 0;
 const char *names[]={"mnt","cgroup"};int kinds[]={CLONE_NEWNS,CLONE_NEWCGROUP};
 for(int i=0;i<2;i++){
  char path[80];snprintf(path,sizeof(path),"/proc/%ld/ns/%s",(long)c->child[0],names[i]);
  int fd=open(path,O_RDONLY|O_CLOEXEC);struct statfs fs;struct stat host;
  if(fd<0)return 0;
  c->ns[i]=fd;
  if(fstat(fd,&c->ns_stat[i])||fstatfs(fd,&fs)||fs.f_type!=NSFS_MAGIC||
     ioctl(fd,NS_GET_NSTYPE)!=kinds[i]||!namespace_stat(getpid(),names[i],&host)||
     same_inode(&host,&c->ns_stat[i]))return 0;
 }
 return open_view(c,0)&&stopped(c,0,c->launcher)&&bindings(c);
}
static int limits(struct context *c) {
 return text_is(c->outer,"pids.max","128\n")&&text_is(c->outer,"memory.max","536870912\n")&&
  text_is(c->outer,"memory.swap.max","0\n")&&text_is(c->outer,"cpu.max","50000 100000\n");
}
static int controllers(int dir,int enabled) {
 char text[4097];int fd=control(dir,"cgroup.subtree_control",O_RDONLY);if(fd<0)return 0;
 int ok=read_fd(fd,text,sizeof(text));close(fd);if(!ok)return 0;
 if(!enabled)return !text[0]||!strcmp(text,"\n");
 char *save=NULL;unsigned mask=0;
 for(char *p=strtok_r(text," \n",&save);p;p=strtok_r(NULL," \n",&save)){
  unsigned bit=!strcmp(p,"cpu")?1:!strcmp(p,"memory")?2:!strcmp(p,"pids")?4:0;
  if(!bit||(mask&bit))return 0;
  mask|=bit;
 }
 return mask==7;
}
static int open_inner(struct context *c,const char *name,int *fd,struct stat *saved) {
 *fd=openat(c->outer,name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
 struct statfs fs;
 return root_directory(*fd,1)&&!fstat(*fd,saved)&&saved->st_dev==c->outer_stat.st_dev&&
  !fstatfs(*fd,&fs)&&fs.f_type==CGROUP2_SUPER_MAGIC&&text_is(*fd,"cgroup.type","domain\n");
}
static int known_children(int dir,int parent,int *launcher,int *payload) {
 if(!budget_ok())return 0;
 int copy=openat(dir,".",O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(copy<0)return 0;
 DIR *d=fdopendir(copy);if(!d){close(copy);return 0;}struct dirent *e;int ok=1;
 *launcher=*payload=0;unsigned scanned=0;
 while((e=readdir(d))){
  if(!budget_ok()||++scanned>256){ok=0;break;}
  if(!strcmp(e->d_name,".")||!strcmp(e->d_name,".."))continue;
  struct stat s;if(fstatat(dir,e->d_name,&s,AT_SYMLINK_NOFOLLOW)){ok=0;break;}
  if(S_ISDIR(s.st_mode)){
   if(!strcmp(e->d_name,parent?"controller":"launcher"))(*launcher)++;
   else if(!parent&&!strcmp(e->d_name,"payload"))(*payload)++;
   else{ok=0;break;}
  }else if(!S_ISREG(s.st_mode)){ok=0;break;}
 }
 closedir(d);return ok&&budget_ok()&&*launcher<=1&&*payload<=1;
}
static int inner_custody(struct context *c,const char *name,int fd,const struct stat *saved) {
 struct stat s;
 return root_directory(fd,1)&&!fstatat(c->outer,name,&s,AT_SYMLINK_NOFOLLOW)&&same_inode(&s,saved)&&
  !s.st_uid&&!s.st_gid&&(s.st_mode&07777)==0700&&budget_ok();
}
static int empty_inner_remove(struct context *c,const char *name,int fd,const struct stat *saved) {
 int a,b;
 return inner_custody(c,name,fd,saved)&&controllers(fd,0)&&known_children(fd,0,&a,&b)&&!a&&!b&&empty(fd)&&
  bindings(c)&&budget_ok()&&unlinkat(c->outer,name,AT_REMOVEDIR)==0;
}
static int remove_record(struct context *c,const char *name) {
 if(!budget_ok())return 0;
 struct stat s;
 if(fstatat(c->work,name,&s,AT_SYMLINK_NOFOLLOW))return errno==ENOENT;
 struct record r={0};
 return intent(c->work,name,&r)&&records_equal(&r,&c->record)&&budget_ok()&&unlinkat(c->work,name,0)==0;
}
static int cleanup_until(struct context *c,int notify,long long until) {
 active_until=until;
 /* Lack of a pinned original outer must never count as cleanup success. */
 if(!c->owned)return 0;
 if(!bindings(c))return 0;
 int a,b,sub_a,sub_b;
 if(!known_children(c->outer,0,&a,&b)||(!a&&b))return 0;
 if(a&&(!inner_custody(c,"launcher",c->launcher,&c->inner_stat[0])||!controllers(c->launcher,0)||
    !known_children(c->launcher,0,&sub_a,&sub_b)||sub_a||sub_b))return 0;
 if(b&&(!inner_custody(c,"payload",c->payload,&c->inner_stat[1])||!controllers(c->payload,0)||
    !known_children(c->payload,0,&sub_a,&sub_b)||sub_a||sub_b))return 0;
 long long now=clock_ms();if(now<0||now>=until)return 0;
 if(c->published){
  /* Repeat the original journal, held-kill-FD and expected child checks at
   * the destructive boundary. This does NOT replace independent root
   * bootstrap custody or make the check-and-write atomic. */
  int current_a,current_b;
  if(!bindings(c)||!known_children(c->outer,0,&current_a,&current_b)||
     current_a!=a||current_b!=b||
     (a&&!inner_custody(c,"launcher",c->launcher,&c->inner_stat[0]))||
     (b&&!inner_custody(c,"payload",c->payload,&c->inner_stat[1]))||
     !budget_ok())return 0;
  if(lseek(c->killfd,0,SEEK_SET)<0||write(c->killfd,"1",1)!=1)return 0;
 }else if(!empty(c->outer))return 0;
 int done=0;
 for(;;){
  long long now=clock_ms();if(now<0||now>=until)break;
  int status;pid_t got;
  while((got=waitpid(-1,&status,WNOHANG))>0){}
  if(got<0&&errno!=ECHILD&&errno!=EINTR)return 0;
  int reaped=got<0&&errno==ECHILD;
  if(empty(c->outer)&&(c->pidfd[0]<0||pidfd_state(c->pidfd[0])==1)&&
     (c->pidfd[1]<0||pidfd_state(c->pidfd[1])==1)&&reaped){done=1;break;}
  usleep(1000);
 }
 if(!done||!bindings(c))return 0;
 for(int i=0;i<2;i++){
  if(c->view[i]>=0){close(c->view[i]);c->view[i]=-1;}
  if(c->ns[i]>=0){close(c->ns[i]);c->ns[i]=-1;}
 }
 if(notify&&!event_until(c,"EMPTY",until))return 0;
 if(!known_children(c->outer,0,&a,&b)||clock_ms()<0||clock_ms()>=until)return 0;
 if(b&&(!empty_inner_remove(c,"payload",c->payload,&c->inner_stat[1])))return 0;
 if(a&&(!empty_inner_remove(c,"launcher",c->launcher,&c->inner_stat[0])))return 0;
 if(!bindings(c)||!empty(c->outer)||clock_ms()<0||clock_ms()>=until||
    unlinkat(c->parent,c->record.name,AT_REMOVEDIR))return 0;
 c->owned=0;
 if(!bindings(c)||!remove_record(c,"intent.v1"))return 0;
 c->published=0;
 return bindings(c)&&remove_record(c,"intent.tmp")&&budget_ok()&&fsync(c->work)==0&&budget_ok();
}
static int cleanup(struct context *c,int notify) {
 return cleanup_until(c,notify,begin_operation());
}
static int setup(struct context *c) {
 c->work=pin_directory(WORK);
 struct statfs workfs;
 if(!root_directory(c->work,1)||fstat(c->work,&c->work_stat)||fstatfs(c->work,&workfs)||
    workfs.f_type!=TMPFS_MAGIC)return 0;
 c->lock=open_regular(c->work,".lock",O_RDWR,0600,0,1);
 if(!regular_root(c->lock,0600,0)||fstat(c->lock,&c->lock_stat))return 0;
 if(flock(c->lock,LOCK_EX|LOCK_NB)){
  c->reason=(errno==EAGAIN||errno==EWOULDBLOCK)?"LOCK_DENIED":"LOCK_ERROR";return 0;
 }
 if(!approval(c->work,&c->record))return 0;
 c->parent=pin_directory(PARENT);struct statfs fs;
 if(c->parent<0||fstat(c->parent,&c->parent_stat)||fstatfs(c->parent,&fs)||fs.f_type!=CGROUP2_SUPER_MAGIC||
    (unsigned long long)c->parent_stat.st_dev!=c->record.parent_dev||
    (unsigned long long)c->parent_stat.st_ino!=c->record.parent_ino||
    !text_is(c->parent,"cgroup.type","domain\n")||!text_is(c->parent,"cgroup.procs",""))return 0;
 return bindings(c);
}
static int open_outer(struct context *c) {
 c->outer=openat(c->parent,c->record.name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
 struct statfs fs;
 if(!root_directory(c->outer,1)||fstat(c->outer,&c->outer_stat)||fstatfs(c->outer,&fs)||
    fs.f_type!=CGROUP2_SUPER_MAGIC||c->outer_stat.st_dev!=c->parent_stat.st_dev||
    (unsigned long long)c->outer_stat.st_dev!=c->record.outer_dev||
    (unsigned long long)c->outer_stat.st_ino!=c->record.outer_ino)return 0;
 c->procs=control(c->outer,"cgroup.procs",O_RDONLY);
 c->events=control(c->outer,"cgroup.events",O_RDONLY);
 c->killfd=control(c->outer,"cgroup.kill",O_WRONLY);
 if(c->procs<0||c->events<0||c->killfd<0)return 0;
 c->owned=1;return bindings(c);
}
static int reopen_inner(struct context *c) {
 int a,b;if(!known_children(c->outer,0,&a,&b)||(!a&&b))return 0;
 if(a&&!open_inner(c,"launcher",&c->launcher,&c->inner_stat[0]))return 0;
 if(b&&!open_inner(c,"payload",&c->payload,&c->inner_stat[1]))return 0;
 return 1;
}
static int parent_single_outer(struct context *c,char *name,size_t cap,struct stat *saved) {
 if(!budget_ok())return -1;
 int copy=openat(c->parent,".",O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(copy<0)return -1;
 DIR *d=fdopendir(copy);if(!d){close(copy);return -1;}struct dirent *e;int count=0,keeper=0;unsigned scanned=0;
 while((e=readdir(d))){
  if(!budget_ok()||++scanned>256){count=-1;break;}
  if(!strcmp(e->d_name,".")||!strcmp(e->d_name,".."))continue;
  struct stat s;if(fstatat(c->parent,e->d_name,&s,AT_SYMLINK_NOFOLLOW)){count=-1;break;}
  if(!strcmp(e->d_name,"controller")){
   if(++keeper!=1||!S_ISDIR(s.st_mode)||s.st_uid||s.st_gid||(s.st_mode&0022)||
      s.st_dev!=c->parent_stat.st_dev){count=-1;break;}
   continue;
  }
  if(S_ISDIR(s.st_mode)){
   if(++count>1||strlen(e->d_name)!=23||strncmp(e->d_name,"worker-",7)||!hex_string(e->d_name+7,16)||
      strlen(e->d_name)>=cap){count=-1;break;}
   strcpy(name,e->d_name);*saved=s;
  }else if(!S_ISREG(s.st_mode)){count=-1;break;}
 }
 closedir(d);return keeper==1&&budget_ok()?count:-1;
}
static int sweep_empty(struct context *c) {
 struct stat s;struct record pending={0};int has_temp=0;
 if(fstatat(c->work,"intent.v1",&s,AT_SYMLINK_NOFOLLOW)==0||errno!=ENOENT)return 0;
 if(fstatat(c->work,"intent.tmp",&s,AT_SYMLINK_NOFOLLOW)==0){
  if(!intent(c->work,"intent.tmp",&pending)||strcmp(pending.invocation,c->record.invocation)||
     pending.parent_dev!=c->record.parent_dev||pending.parent_ino!=c->record.parent_ino)return 0;
  has_temp=1;
 }else if(errno!=ENOENT)return 0;
 char name[24]={0};int count=parent_single_outer(c,name,sizeof(name),&s);if(count<0)return 0;
 if(count){
  /* Never adopt a worker-* directory by name alone. An interrupted birth
   * with no canonical original intent remains QUARANTINE, not a sweep. */
  if(!has_temp||strcmp(name,pending.name)||(unsigned long long)s.st_dev!=pending.outer_dev||
     (unsigned long long)s.st_ino!=pending.outer_ino)return 0;
  strcpy(c->record.name,name);c->record.outer_dev=s.st_dev;c->record.outer_ino=s.st_ino;
  if(!open_outer(c)||!controllers(c->outer,0)||!reopen_inner(c)||!empty(c->outer))return 0;
  if(!cleanup_until(c,0,active_until))return 0;
  /* cleanup validated and removed this exact matching unpublished temp. */
  has_temp=0;
 }
 if(has_temp){
  if(fstatat(c->parent,pending.name,&s,AT_SYMLINK_NOFOLLOW)==0||errno!=ENOENT)return 0;
  struct record now={0};if(!intent(c->work,"intent.tmp",&now)||!records_equal(&now,&pending)||
     !bindings(c)||unlinkat(c->work,"intent.tmp",0))return 0;
 }
 return budget_ok()&&fsync(c->work)==0&&budget_ok();
}
static int wait_injected_exit(struct context *c,int code) {
 long long until=begin_operation();
 for(;;){
  long long now=clock_ms();if(now<0||now>=until)return 0;
  int status;pid_t got=waitpid(c->child[0],&status,WNOHANG);
  if(got==c->child[0])return WIFEXITED(status)&&WEXITSTATUS(status)==code;
  if(got<0&&errno!=EINTR)return 0;
  usleep(1000);
 }
}
int main(int argc,char **argv) {
 const char *modes[]={"run","crash-pre-namespace","crash-pinned","crash-ready","fail-mount","fail-enable","recover","sweep-empty"};
 int valid=0;if(argc==2)for(size_t i=0;i<sizeof(modes)/sizeof(modes[0]);i++)if(!strcmp(argv[1],modes[i]))valid=1;
 if(!valid)return 64;
 /* GE-04 SECURITY HOLD: regular builds MUST NOT enter a privileged fixture,
  * even if root stages matching approval/unit files. The opt-in macro is
  * deliberately absent from ordinary builds and is NOT approval itself;
  * reviewed-source/staging/VM/Q13 gates remain independently mandatory. */
#ifndef GE04_REVIEWED_DISPOSABLE_VM_QUALIFICATION
 return 77;
#endif
 if(getuid()||geteuid()||getgid()||getegid())return 77;
 signal(SIGPIPE,SIG_IGN);signal(SIGCHLD,SIG_DFL);
 struct context c={.work=-1,.lock=-1,.parent=-1,.outer=-1,.launcher=-1,.payload=-1,.procs=-1,.events=-1,.killfd=-1,
  .pidfd={-1,-1},.ns={-1,-1},.view={-1,-1},.mode=argv[1],.reason="PRECONDITION"};
 int code=77,clean=0;
 begin_operation();
 if(!setup(&c))goto finished;
 begin_operation();
 if(!strcmp(c.mode,"sweep-empty")){clean=sweep_empty(&c);c.reason=clean?"EMPTY_SWEEP":"QUARANTINE";code=clean?0:77;goto finished;}
 if(!strcmp(c.mode,"recover")){
  struct record r={0};
  if(!intent(c.work,"intent.v1",&r)||strcmp(r.invocation,c.record.invocation)||
     r.parent_dev!=c.record.parent_dev||r.parent_ino!=c.record.parent_ino){c.reason="INTENT_DENIED";goto finished;}
  c.record=r;c.published=1;
  if(!open_outer(&c)||!reopen_inner(&c)){c.reason="BINDING_DENIED";goto finished;}
  clean=cleanup(&c,1);code=clean?0:77;c.reason=clean?"RECOVERED":"QUARANTINE";goto finished;
 }
 struct stat s;char existing[24];struct stat unused;
 if(fstatat(c.work,"intent.v1",&s,AT_SYMLINK_NOFOLLOW)==0||errno!=ENOENT||
    fstatat(c.work,"intent.tmp",&s,AT_SYMLINK_NOFOLLOW)==0||errno!=ENOENT||
    parent_single_outer(&c,existing,sizeof(existing),&unused)!=0){c.reason="EXISTING_STATE";goto finished;}
 if(prctl(PR_SET_CHILD_SUBREAPER,1,0,0,0))goto finished;
 unsigned char random[8];if(!budget_ok()||getrandom(random,8,GRND_NONBLOCK)!=8)goto finished;
 strcpy(c.record.name,"worker-");for(int i=0;i<8;i++)snprintf(c.record.name+7+i*2,3,"%02x",random[i]);
 if(!budget_ok()||mkdirat(c.parent,c.record.name,0700))goto finished;
 int initial=openat(c.parent,c.record.name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);
 if(initial<0||fstat(initial,&s)){if(initial>=0)close(initial);goto finished;}close(initial);
 c.record.outer_dev=s.st_dev;c.record.outer_ino=s.st_ino;
 if(!open_outer(&c))goto finished;
 if(!empty(c.outer)||!controllers(c.outer,0)||!text_is(c.outer,"cgroup.type","domain\n")||
    !budget_ok()||mkdirat(c.outer,"launcher",0700)||!budget_ok()||mkdirat(c.outer,"payload",0700)||
    !open_inner(&c,"launcher",&c.launcher,&c.inner_stat[0])||
    !open_inner(&c,"payload",&c.payload,&c.inner_stat[1])||
    !set_text(c.outer,"pids.max","128")||!set_text(c.outer,"memory.max","536870912")||
    !set_text(c.outer,"memory.swap.max","0")||!set_text(c.outer,"cpu.max","50000 100000")||
    !limits(&c)){c.reason="RESOURCE_DENIED";goto rollback;}
 if(!publish(&c)){c.reason="INTENT_DENIED";goto rollback;}
 if(!event(&c,"INTENT")){c.reason="ACK_DENIED";goto rollback;}
 if(!bindings(&c)||!spawn_child(&c,0)){c.reason="CLONE_UNAVAILABLE";goto rollback;}
 if(!wait_stop(&c,0,0)){c.reason="STOP_DENIED";goto rollback;}
 if(!event(&c,"PRE_NAMESPACE")){c.reason="ACK_DENIED";goto rollback;}
 if(!strcmp(c.mode,"crash-pre-namespace"))_exit(88);
 if(!continue_child(&c,0)){c.reason="STOP_DENIED";goto rollback;}
 if(!strcmp(c.mode,"fail-mount")){
  c.reason=wait_injected_exit(&c,122)?"MOUNT_INJECTED":"BOOTSTRAP_FAILED";goto rollback;
 }
 if(!wait_stop(&c,0,1)||!pin_view(&c)){c.reason="VIEW_DENIED";goto rollback;}
 if(!event(&c,"PINNED")){c.reason="ACK_DENIED";goto rollback;}
 if(!strcmp(c.mode,"crash-pinned"))_exit(88);
 if(!strcmp(c.mode,"fail-enable")){
  errno=0;c.reason=write(-1,"+cpu",4)==-1&&errno==EBADF?"ENABLE_EBADF":"INJECTION_FAILED";goto rollback;
 }
 if(!bindings(&c)||!text_is(c.outer,"cgroup.procs","")||
    !set_text(c.outer,"cgroup.subtree_control","+cpu +memory +pids")||!controllers(c.outer,1)||
    !limits(&c)||!set_text(c.launcher,"pids.max","64")||!text_is(c.launcher,"pids.max","64\n")){
  c.reason="RESOURCE_DENIED";goto rollback;
 }
 if(!event(&c,"ENABLED")){c.reason="ACK_DENIED";goto rollback;}
 if(!bindings(&c)||!spawn_child(&c,1)){c.reason="CLONE_UNAVAILABLE";goto rollback;}
 if(!wait_stop(&c,1,0)){c.reason="STOP_DENIED";goto rollback;}
 if(!event(&c,"PRE_JOIN")){c.reason="ACK_DENIED";goto rollback;}
 if(!continue_child(&c,1)||!wait_stop(&c,1,1)||!open_view(&c,1)){c.reason="JOIN_FAILED";goto rollback;}
 pid_t ids[128];int n=members(c.launcher,ids,128);
 if(n!=2||!((ids[0]==c.child[0]&&ids[1]==c.child[1])||(ids[1]==c.child[0]&&ids[0]==c.child[1]))||
    !empty(c.payload)||!limits(&c)||!controllers(c.outer,1)||!bindings(&c)){c.reason="VIEW_DENIED";goto rollback;}
 if(!event(&c,"READY")){c.reason="ACK_DENIED";goto rollback;}
 if(!strcmp(c.mode,"crash-ready"))_exit(88);
 clean=cleanup(&c,1);code=clean?0:77;c.reason=clean?"COMPLETED":"QUARANTINE";goto finished;
rollback:
 clean=cleanup(&c,1);if(!clean)c.reason="QUARANTINE";
finished:
 if(!strcmp(c.reason,"QUARANTINE")||!strcmp(c.reason,"BINDING_DENIED"))(void)event(&c,"DENIED");
 printf("RESULT code=%d reason=%s clean=%d\n",code,c.reason,clean);fflush(stdout);
 int fds[]={c.pidfd[0],c.pidfd[1],c.ns[0],c.ns[1],c.view[0],c.view[1],c.killfd,c.events,c.procs,
  c.payload,c.launcher,c.outer,c.parent,c.lock,c.work};
 for(size_t i=0;i<sizeof(fds)/sizeof(fds[0]);i++)if(fds[i]>=0)close(fds[i]);
 return code;
}
