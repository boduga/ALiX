/* Unprivileged exercise of the closed fixture's admission predicates.
 * NEVER calls the privileged main: it includes the worker source with main
 * renamed, then only evaluates pure predicates over fabricated inputs.
 * No cgroup, unit, root, systemd or filesystem mutation is performed.
 */
#define main ge04_worker_root_entry_not_called
#include "../../native/ge04/cgroup-worker-qualification.c"
#undef main

static int parse_ull(const char *text,unsigned long long *out) {
 char *end=NULL;
 if(!text||!*text)return 0;
 errno=0;*out=strtoull(text,&end,10);
 return !errno&&end&&!*end;
}
static int parse_octal(const char *text,unsigned long long *out) {
 char *end=NULL;
 if(!text||!*text||text[0]<'0'||text[0]>'7')return 0;
 errno=0;*out=strtoull(text,&end,8);
 return !errno&&end&&!*end;
}
/* sweep <has_temp> <observed_dev> <observed_ino> <pending_dev> <pending_ino>
 *       <observed_name> <pending_name> <pending_parent_ino>
 * Emits 1 when the sweep may remove the observed directory, else 0. */
static int sweep_case(int argc,char **argv) {
 if(argc!=10)return 64;
 unsigned long long has_temp,observed_dev,observed_ino,pending_dev,pending_ino,parent_ino;
 if(!parse_ull(argv[2],&has_temp)||!parse_ull(argv[3],&observed_dev)||
    !parse_ull(argv[4],&observed_ino)||!parse_ull(argv[5],&pending_dev)||
    !parse_ull(argv[6],&pending_ino)||!parse_ull(argv[9],&parent_ino))return 64;
 struct record pending={0};
 struct stat observed={0};
 pending.parent_ino=parent_ino;
 pending.leaf_dev=pending_dev;
 pending.leaf_ino=pending_ino;
 if(strlen(argv[8])!=23)return 64;
 strcpy(pending.name,argv[8]);
 observed.st_dev=(dev_t)observed_dev;
 observed.st_ino=(ino_t)observed_ino;
 printf("SWEEP %d\n",sweep_candidate_allowed((int)has_temp,&pending,&observed,argv[7]));
 return 0;
}
int main(int argc,char **argv) {
 if(argc<2)return 64;
 if(!strcmp(argv[1],"sweep"))return sweep_case(argc,argv);
 if(!strcmp(argv[1],"identity")){
  if(argc!=6)return 64;
  unsigned long long uid,euid,gid,egid;
  if(!parse_ull(argv[2],&uid)||!parse_ull(argv[3],&euid)||
     !parse_ull(argv[4],&gid)||!parse_ull(argv[5],&egid))return 64;
  printf("IDENTITY %d\n",root_identity_of((uid_t)uid,(uid_t)euid,(gid_t)gid,(gid_t)egid));
  return 0;
 }
 if(!strcmp(argv[1],"directory")||!strcmp(argv[1],"regular")){
  /* <kind> <uid> <gid> <mode-octal>: group-owned paths must refuse. */
  if(argc!=5)return 64;
  unsigned long long uid,gid,mode;
  if(!parse_ull(argv[2],&uid)||!parse_ull(argv[3],&gid)||!parse_octal(argv[4],&mode))return 64;
  struct stat s={0};
  s.st_uid=(uid_t)uid;s.st_gid=(gid_t)gid;s.st_mode=(mode_t)mode;
  if(!strcmp(argv[1],"directory")){
   s.st_mode|=S_IFDIR;
   printf("DIRECTORY %d\n",root_directory_stat(&s));
  }else{
   s.st_mode|=S_IFREG;
   s.st_nlink=1;
   /* Expected record mode is fixed 0600; only the observed mode varies. */
   printf("REGULAR %d\n",regular_root_stat(&s,(mode_t)0600,0));
  }
  return 0;
 }
 if(!strcmp(argv[1],"control")){
  /* <uid> <gid> <mode-octal> <same_dev 0|1> */
  if(argc!=6)return 64;
  unsigned long long uid,gid,mode,same;
  if(!parse_ull(argv[2],&uid)||!parse_ull(argv[3],&gid)||
     !parse_octal(argv[4],&mode)||!parse_ull(argv[5],&same))return 64;
  struct stat s={0},base={0};
  s.st_uid=(uid_t)uid;s.st_gid=(gid_t)gid;s.st_mode=(mode_t)(mode|S_IFREG);s.st_dev=7;
  base.st_dev=same?7:8;
  printf("CONTROL %d\n",control_stat(&s,&base));
  return 0;
 }
 return 64;
}
