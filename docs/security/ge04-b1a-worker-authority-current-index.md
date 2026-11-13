# GE-04 B1-A.03 — Current worker source authority index (author-side)

**Disposition: SOURCE CITATIONS RECONCILED; SECURITY REVIEW AND HUMAN ACCEPTANCE OPEN. GE-04 SECURITY HOLD ACTIVE.**

Source: `native/ge04/cgroup-worker-qualification.c`
SHA-256: `db3853acecc9f91c6a0c6aa594caeefeac5b80e3c735cea0d9fac873623c4e3e`
Revision: committed GE-04 A.03 review baseline `acefca731e6b1bbeb6af958883c1bd4042aa475c`, 2026-11-11. Regenerate this index if the source hash changes. This index is not a privileged qualification, branch-coverage claim, complete callgraph, or reviewer acceptance.

**Method:** The 41 function candidates are named `static` C function definitions plus `main` matched lexically. The 98 sensitive lines match the following conservative regex: `\b(?:open|openat|close|read|write|unlinkat|mkdirat|rmdir|fstat|fstatat|fstatfs|fsync|syscall|fork|clone|setuid|setgid|kill|waitpid|waitid|return\s+77|_exit|O_EXCL|O_NOFOLLOW)\b`. This is a reproducible lexical search, not a complete security-sensitive operation inventory. In particular, it may omit macro-expanded, indirect, and non-keyword authority decisions; review all control-flow and negative paths separately.

## Function candidates (41)

`approval`, `bindings`, `cleanup`, `clock_ms`, `control`, `control_custody`, `control_stat`, `empty`, `event`, `hex_string`, `intent_text`, `main`, `members`, `no_worker_directories`, `open_controls`, `open_recorded_leaf`, `pidfd_alive`, `pin_directory`, `process_info`, `publish`, `read_fd`, `read_intent`, `read_record_file`, `records_equal`, `regular_root`, `regular_root_stat`, `remove_artifact`, `root_directory`, `root_directory_stat`, `root_identity`, `root_identity_of`, `root_owned`, `same_inode`, `setup`, `stat_info`, `sweep_candidate_allowed`, `sweep_empty`, `wait_running`, `wait_stopped`, `worker`, `write_all`

## Sensitive-site citations (98)

- L2: ` * No arbitrary path/PID/UID/executable interface, setuid installation or fallback.`
- L23: `#include <sys/syscall.h>`
- L55: ` * root-group-only or setgid object is not the protected component. */`
- L60: ` * native libraries. Root-group-only or setgid invocation must refuse. Split`
- L61: ` * from the syscall form so the exact predicate is executable in tests. */`
- L73: ` return fd>=0&&!fstat(fd,&s)&&root_directory_stat(&s);`
- L78: ` strcpy(copy,path);int fd=open("/",O_RDONLY|O_DIRECTORY|O_CLOEXEC);`
- L79: ` if(!root_directory(fd)){if(fd>=0)close(fd);return -1;}`
- L82: `  if(!strcmp(p,".")||!strcmp(p,"..")){close(fd);return -1;}`
- L83: `  int next=openat(fd,p,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);close(fd);fd=next;`
- L84: `  if(!root_directory(fd)){if(fd>=0)close(fd);return -1;}`
- L89: ` /* Exact mode, including setgid/setuid bits: a setgid record is not trusted. */`
- L95: ` return fd>=0&&!fstat(fd,&s)&&regular_root_stat(&s,mode,max);`
- L101: `  ssize_t n=read(fd,out+used,cap-1-used);`
- L108: ` int fd=openat(dir,name,O_RDONLY|O_NOFOLLOW|O_CLOEXEC);`
- L109: ` if(!regular_root(fd,0600,cap-1)){if(fd>=0)close(fd);return 0;}`
- L111: ` int ok=read_fd(fd,out,cap)&&!fstat(fd,&st)&&(size_t)st.st_size==strlen(out);`
- L112: ` close(fd);return ok;`
- L149: ` int fd=openat(leaf,name,flags|O_NOFOLLOW|O_CLOEXEC);struct stat s,base;struct statfs fs;`
- L150: ` if(fd<0||fstat(fd,&s)||fstat(leaf,&base)||fstatfs(fd,&fs)||fs.f_type!=CGROUP2_SUPER_MAGIC||`
- L151: `    !control_stat(&s,&base)){if(fd>=0)close(fd);return -1;}`
- L157: ` c->killfd=control(c->leaf,"cgroup.kill",O_WRONLY);`
- L162: ` return fd>=0&&!fstat(fd,&pinned)&&!fstatat(dir,name,&named,AT_SYMLINK_NOFOLLOW)&&`
- L168: ` int ok=fd>=0&&!fstat(fd,&s)&&(s.st_mode&07777)==0700&&same_inode(&s,&c->work_stat);if(fd>=0)close(fd);`
- L169: ` if(!ok||!regular_root(c->lock,0600,0)||fstatat(c->work,".lock",&s,AT_SYMLINK_NOFOLLOW)||`
- L172: ` fd=pin_directory(PARENT);ok=fd>=0&&!fstat(fd,&s)&&same_inode(&s,&c->parent_stat);if(fd>=0)close(fd);`
- L173: ` if(!ok||!root_directory(c->leaf)||fstatat(c->parent,c->record.name,&s,AT_SYMLINK_NOFOLLOW)||`
- L177: `    !control_custody(c->leaf,"cgroup.kill",c->killfd,c->leaf_stat.st_dev))return 0;`
- L209: `  return read(0,&command,1)==1&&command=='c';`
- L214: ` while(offset<n){ssize_t k=write(fd,data+offset,n-offset);if(k<0&&errno==EINTR)continue;if(k<=0)return 0;offset+=(size_t)k;}`
- L219: ` int fd=openat(c->work,"intent.tmp",O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);`
- L221: ` int ok=write_all(fd,text,strlen(text))&&!fsync(fd);close(fd);`
- L223: ` if(!strcmp(c->mode,"crash-temp"))_exit(88);`
- L225: ` if(syscall(SYS_renameat2,c->work,"intent.tmp",c->work,"intent.v1",RENAME_NOREPLACE))return 0;`
- L231: `  errno=0;if(fsync(-1)!=-1||errno!=EBADF)return 0;`
- L234: ` return fsync(c->work)==0;`
- L238: ` snprintf(path,sizeof(path),"/proc/%ld/stat",(long)pid);fd=open(path,O_RDONLY|O_CLOEXEC|O_NOFOLLOW);`
- L240: ` int ok=read_fd(fd,text,sizeof(text));close(fd);if(!ok)return 0;`
- L251: ` snprintf(path,sizeof(path),"/proc/%ld/status",(long)pid);fd=open(path,O_RDONLY|O_CLOEXEC|O_NOFOLLOW);`
- L253: ` ok=read_fd(fd,text,sizeof(text));close(fd);if(!ok)return 0;`
- L287: `  int status;pid_t got=waitpid(c->child,&status,WNOHANG|WUNTRACED);`
- L296: ` /* Close the shared flock open-file description and both controller pipes`
- L299: ` int nullfd=open("/dev/null",O_RDWR|O_NOFOLLOW|O_CLOEXEC);struct stat s;`
- L300: ` if(nullfd<0||fstat(nullfd,&s)||!S_ISCHR(s.st_mode)||!root_owned(&s)||s.st_rdev!=makedev(1,3))_exit(125);`
- L301: ` for(int i=0;i<3;i++)if(dup2(nullfd,i)<0)_exit(125);`
- L303: ` if(syscall(SYS_close_range,3U,~0U,0))_exit(125);`
- L305: ` _exit(125);`
- L307: ` if(raise(SIGSTOP))_exit(125);`
- L309: `    setresgid(TEST_UID,TEST_UID,TEST_UID)||setresuid(TEST_UID,TEST_UID,TEST_UID))_exit(125);`
- L310: ` uid_t ru,eu,su;gid_t rg,eg,sg;if(getresuid(&ru,&eu,&su)||getresgid(&rg,&eg,&sg)||ru!=TEST_UID||eu!=TEST_UID||su!=TEST_UID||rg!=TEST_UID||eg!=TEST_UID||sg!=TEST_UID||getgroups(0,NULL)!=0)_exit(125);`
- L311: ` pid_t descendant=fork();if(descendant<0)_exit(125);`
- L312: ` if(!descendant&&setsid()<0)_exit(125);`
- L329: ` if(fstatat(c->work,name,&s,AT_SYMLINK_NOFOLLOW))return errno==ENOENT;`
- L331: ` return unlinkat(c->work,name,0)==0;`
- L338: `  if(lseek(c->killfd,0,SEEK_SET)<0||write(c->killfd,"1",1)!=1)return 0;`
- L346: `    while((n=waitpid(-1,&status,WNOHANG))>0){}`
- L353: ` if(!bindings(c)||!empty(c)||unlinkat(c->parent,c->record.name,AT_REMOVEDIR))return 0;`
- L355: ` if(!remove_artifact(c,"intent.v1")||!remove_artifact(c,"intent.tmp")||fsync(c->work))return 0;`
- L359: ` int fd=openat(c->parent,".",O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(fd<0)return 0;`
- L360: ` DIR *dir=fdopendir(fd);if(!dir){close(fd);return 0;}struct dirent *e;int ok=1;`
- L363: `  struct stat s;if(fstatat(c->parent,e->d_name,&s,AT_SYMLINK_NOFOLLOW)||S_ISDIR(s.st_mode)){ok=0;break;}`
- L369: ` if(c->work<0||fstat(c->work,&c->work_stat)||(c->work_stat.st_mode&07777)!=0700)return 0;`
- L370: ` c->lock=openat(c->work,".lock",O_RDWR|O_CREAT|O_NOFOLLOW|O_CLOEXEC,0600);`
- L371: ` if(!regular_root(c->lock,0600,0)||fstat(c->lock,&c->lock_stat))return 0;`
- L378: ` if(c->parent<0||fstat(c->parent,&c->parent_stat)||fstatfs(c->parent,&fs)||fs.f_type!=CGROUP2_SUPER_MAGIC||`
- L381: ` int fd=control(c->parent,"cgroup.procs",O_RDONLY);char text[64];int ok=fd>=0&&read_fd(fd,text,sizeof(text))&&!text[0];if(fd>=0)close(fd);`
- L385: ` c->leaf=openat(c->parent,c->record.name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);`
- L387: ` if(!root_directory(c->leaf)||fstat(c->leaf,&c->leaf_stat)||fstatfs(c->leaf,&fs)||fs.f_type!=CGROUP2_SUPER_MAGIC||`
- L407: ` if(fstatat(c->work,"intent.v1",&st,AT_SYMLINK_NOFOLLOW)==0||errno!=ENOENT)return 0;`
- L409: ` if(fstatat(c->work,"intent.tmp",&st,AT_SYMLINK_NOFOLLOW)==0){`
- L413: `  if(fstatat(c->parent,pending.name,&st,AT_SYMLINK_NOFOLLOW)==0){`
- L417: ` int copy=openat(c->parent,".",O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(copy<0)return 0;`
- L418: ` DIR *dir=fdopendir(copy);if(!dir){close(copy);return 0;}struct dirent *e;int ok=1;`
- L421: `  if(fstatat(c->parent,e->d_name,&st,AT_SYMLINK_NOFOLLOW)){ok=0;break;}`
- L428: `  if(!open_recorded_leaf(c)||!empty(c)||!bindings(c)||unlinkat(c->parent,e->d_name,AT_REMOVEDIR)){ok=0;break;}`
- L430: `  close(c->procs);close(c->events);close(c->killfd);close(c->leaf);c->procs=c->events=c->killfd=c->leaf=-1;`
- L435: ` if(fstatat(c->work,"intent.tmp",&st,AT_SYMLINK_NOFOLLOW)==0){`
- L438: `     fstatat(c->parent,temp.name,&st,AT_SYMLINK_NOFOLLOW)==0||errno!=ENOENT||unlinkat(c->work,"intent.tmp",0))return 0;`
- L440: ` return fsync(c->work)==0;`
- L443: ` const char *modes[]={"run","fail-before-clone","fail-attach","fail-verify","fail-resume","fail-publish",`
- L447: ` /* All four identities must be root. A root-group-only or setgid invocation is`
- L449: ` if(!root_identity())return 77;`
- L463: ` if(fstatat(c.work,"intent.v1",&st,AT_SYMLINK_NOFOLLOW)==0||errno!=ENOENT||`
- L464: `    fstatat(c.work,"intent.tmp",&st,AT_SYMLINK_NOFOLLOW)==0||errno!=ENOENT||!no_worker_directories(&c)){`
- L469: ` if(mkdirat(c.parent,c.record.name,0700))goto finished;`
- L470: ` c.leaf=openat(c.parent,c.record.name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);`
- L471: ` if(!root_directory(c.leaf)||fstat(c.leaf,&c.leaf_stat))goto finished;`
- L474: ` if(!strcmp(c.mode,"crash-leaf"))_exit(88);`
- L477: ` if(!strcmp(c.mode,"crash-intent"))_exit(88);`
- L478: ` if(!strcmp(c.mode,"fail-before-clone")){reason="BEFORE_CLONE";goto rollback;}`
- L484: ` c.child=(pid_t)syscall(SYS_clone3,&args,sizeof(args));`
- L491: ` if(!strcmp(c.mode,"crash-child"))_exit(88);`
- L495: `  errno=0;if(write(-1,"0",1)!=-1||errno!=EBADF)reason="INJECTION_FAILED";else reason="ATTACH_EBADF";goto rollback;`
- L500: ` if(!bindings(&c)||!pidfd_alive(c.pidfd)||lseek(c.procs,0,SEEK_SET)<0||write(c.procs,pid,(size_t)n)!=n||`
- L511: `  errno=0;if(syscall(SYS_pidfd_send_signal,-1,SIGCONT,NULL,0)!=-1||errno!=EBADF)reason="INJECTION_FAILED";else reason="RESUME_EBADF";goto rollback;`
- L513: ` if(syscall(SYS_pidfd_send_signal,c.pidfd,SIGCONT,NULL,0))goto rollback;`
- L518: ` if(!strcmp(c.mode,"crash-running"))_exit(88);`
- L525: ` for(size_t i=0;i<sizeof(fds)/sizeof(fds[0]);i++)if(fds[i]>=0)close(fds[i]);`

## Review limits

All citations above are verified against the source hash stated in this document at generation time. These are source-text pointers only; no executable authorization or independently accepted A.03 evidence follows from this index. The historical matrix section remains available solely for comparison.
