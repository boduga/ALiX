# GE-04 B1-A.03 — Source authority review handoff matrix

**Disposition: AUTHOR EVIDENCE READY FOR INDEPENDENT REVIEW; A.03 NOT ACCEPTED.** No agent or author may substitute for the independent human reviewer. GE-04 SECURITY HOLD ACTIVE.

> **PARTIAL SUPERSESSION — 2026-11-11:** This matrix was generated against commit `d6e22669` and its historical worker source SHA-256 `5362bdb0b08586f51151f0b53519a48ababb557f9c31758283f3aab2ec06d757`. The `cgroup-worker-qualification.c` aggregate row (33 candidates / 57 sites), its function list, and **all 57 line-numbered citations in that section are historical only**; 51 moved and six no longer match the revised predicates. The committed HIGH-1/HIGH-2 worker source currently hashes to `db3853acecc9f91c6a0c6aa594caeefeac5b80e3c735cea0d9fac873623c4e3e`. **A new author-side lexical successor index exists at `docs/security/ge04-b1a-worker-authority-current-index.md` (41 function candidates / 98 sensitive-line citations); it is not independently accepted or exhaustive.** Do not use the historical row or citations to review the current worker; the A.03 evidence gate remains OPEN and the security hold remains active. Other rows have not been revalidated by this note.

## Scope and method

All native `.c` and `.py` files in `native/ge04` are enumerated below. Function candidates come from the existing lexical/AST graph, not a verified whole-program call graph. Sensitive sites are line-numbered lexical matches for filesystem, process, bus, syscall and deny operations. Test links are source-text references, **not branch coverage proof**. The table counts test files (`tests/**/*.py` and `tests/**/*.ts`) containing the exact source filename or, for Python modules, a whole-token module name; counts are verified by `scripts/check-ge04-source-test-references.py` and can include incidental references. An empty row does not prove absence of authority.

| Source | Function candidates | Sensitive sites | Test references |
| --- | ---: | ---: | ---: |
| `bootstrap_binding.py` | 3 | 4 | 11 |
| `bootstrap_publisher.py` | 4 | 4 | 1 |
| `bootstrap_receiver.py` | 1 | 3 | 1 |
| `bounded_dispatch_evidence.py` | 6 | 0 | 1 |
| `bounded_job_signal_observer.py` | 4 | 8 | 1 |
| `bounded_phase_observer.py` | 2 | 8 | 2 |
| `broker-peer-probe.c` | 1 | 6 | 3 |
| `cgroup-control-fd-qualification.c` | 1 | 19 | 1 |
| `cgroup-dirfd-qualification.c` | 3 | 14 | 1 |
| `cgroup-leaf-ownership-qualification.c` | 3 | 14 | 1 |
| `cgroup-runtime-view-qualification.c` | 55 | 99 | 4 |
| `cgroup-worker-qualification.c` | 41 (current successor) | 95 (current successor) | 4 |
| `cgroup2-fixed-preflight.c` | 2 | 16 | 1 |
| `cgroup2-mount-preflight.c` | 1 | 14 | 1 |
| `cross_source_birth_reconciliation.py` | 8 | 0 | 1 |
| `diagnostic-deadline.c` | 8 | 0 | 2 |
| `diagnostic-fd-wait.c` | 3 | 5 | 1 |
| `exclusive_birth_handoff.py` | 13 | 0 | 1 |
| `exec-pinned-probe.c` | 1 | 0 | 2 |
| `exec-pinned.c` | 1 | 0 | 1 |
| `isolated-worker-launcher.c` | 5 | 10 | 4 |
| `isolated_job_signal_worker.py` | 2 | 2 | 0 |
| `isolated_phase_observer_worker.py` | 1 | 2 | 1 |
| `nonexecuting-sender-contract.c` | 5 | 1 | 1 |
| `oci_qualification_image.py` | 13 | 0 | 1 |
| `original_provenance_diagnostic.py` | 6 | 0 | 1 |
| `peercred.c` | 1 | 0 | 3 |
| `phase_controller.py` | 7 | 0 | 3 |
| `pidfd-lifecycle-qualification.c` | 3 | 6 | 1 |
| `pidfd-qualification.c` | 2 | 5 | 1 |
| `prebirth_fixture_journal.py` | 6 | 14 | 2 |
| `prebirth_issuance_contract.py` | 11 | 0 | 5 |
| `protected-attempt-fence.c` | 8 | 23 | 9 |
| `protected-cgroup-custody.c` | 11 | 20 | 2 |
| `protected-dispatch-intent.c` | 9 | 25 | 2 |
| `protected-dispatch-preparation.c` | 7 | 11 | 3 |
| `protected-keeper-custody.c` | 10 | 10 | 3 |
| `protected-mount-namespace.c` | 11 | 14 | 1 |
| `protected-prebirth-journal.c` | 13 | 34 | 9 |
| `protected-root-controller.c` | 1 | 0 | 3 |
| `protected-systemd-birth-observer.c` | 5 | 13 | 4 |
| `protected-systemd-request.c` | 3 | 26 | 3 |
| `protected-systemd-transaction.c` | 15 | 44 | 9 |
| `protected-transaction-state.c` | 1 | 0 | 1 |
| `protected_approval_observer.py` | 4 | 18 | 2 |
| `protected_owner_review_boundary.py` | 10 | 0 | 1 |
| `systemd_absence_observer.py` | 2 | 0 | 2 |
| `systemd_job_event_contract.py` | 6 | 0 | 1 |
| `systemd_job_signal_observer.py` | 3 | 1 | 2 |
| `systemd_unit_observer.py` | 3 | 0 | 1 |
| `transaction_consumption_fixture.py` | 3 | 13 | 1 |
| `unit_kernel_observer.py` | 7 | 14 | 2 |
| `worker-stream.c` | 18 | 16 | 2 |

## Sensitive-site inventory (review every entry)

Line numbers refer to the current checkout; rebase review onto the pinned candidate SHA before acceptance. Every entry below is **UNVERIFIED** until an independent reviewer checks authorization, error propagation, cleanup, TOCTOU and replay paths.

### `bootstrap_binding.py`
Function candidates: `_unique`, `parse_bootstrap_binding`, `read_sealed_bootstrap_binding`.
Test modules referencing this source: `test_ge04_bootstrap_binding.py`, `test_ge04_bootstrap_publisher.py`, `test_ge04_bootstrap_receiver.py`, `test_ge04_bounded_job_signal_observer.py`, `test_ge04_cross_source_birth_reconciliation.py`, `test_ge04_exclusive_birth_handoff.py`, `test_ge04_phase_controller.py`, `test_ge04_prebirth_issuance_contract.py`, `test_ge04_protected_owner_review_boundary.py`, `test_ge04_systemd_job_event_contract.py`, `test_ge04_systemd_job_signal_observer.py`.
- L104: `before = os.fstat(fd)`
- L111: `if fcntl.fcntl(fd, fcntl.F_GET_SEALS) != SEALS:`
- L115: `after = os.fstat(fd)`
- L120: `or fcntl.fcntl(fd, fcntl.F_GET_SEALS) != SEALS):`

### `bootstrap_publisher.py`
Function candidates: `_exact`, `prepare_unprivileged_fixture_fd`, `publish_root_bootstrap`, `validate_prepublished_evidence`.
Test modules referencing this source: `test_ge04_bootstrap_publisher.py`.
- L126: `written = os.write(fd, first)`
- L129: `fcntl.fcntl(fd, fcntl.F_ADD_SEALS, SEALS)`
- L130: `if fcntl.fcntl(fd, fcntl.F_GET_SEALS) != SEALS:`
- L134: `os.close(fd)`

### `bootstrap_receiver.py`
Function candidates: `receive_bootstrap_descriptor`.
Test modules referencing this source: `test_ge04_bootstrap_receiver.py`.
- L67: `payload, ancillary, flags, _ = sock.recvmsg(`
- L100: `os.close(fd)`
- L104: `sock.close()`

### `bounded_job_signal_observer.py`
Function candidates: `_canonical_request`, `_canonical_witness`, `no_duplicates`, `observe_job_signal_bounded`.
Test modules referencing this source: `test_ge04_bounded_job_signal_observer.py`.
- L103: `sent = os.write(process.stdin.fileno(), unsent)`
- L111: `process.stdin.close()`
- L113: `chunk = os.read(process.stdout.fileno(),`
- L117: `process.stdout.close()`
- L130: `selector.close()`
- L132: `process.kill()`
- L135: `process.stdin.close()`
- L137: `process.stdout.close()`

### `bounded_phase_observer.py`
Function candidates: `observe_bounded`, `unique`.
Test modules referencing this source: `test_ge04_bounded_phase_observer.py`.
- L65: `count = os.write(process.stdin.fileno(), remaining_input)`
- L73: `process.stdin.close()`
- L75: `chunk = os.read(process.stdout.fileno(), MAX_OUTPUT + 1 - len(output))`
- L78: `process.stdout.close()`
- L91: `selector.close()`
- L93: `process.kill()`
- L96: `process.stdin.close()`
- L98: `process.stdout.close()`

### `broker-peer-probe.c`
Function candidates: `main`.
Test modules referencing this source: **NONE IDENTIFIED**.
- L26: `int listener = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);`
- L28: `if (bind(listener, (struct sockaddr *)&addr, sizeof(addr)) != 0) { perror("bind"); close(listener); return 1; }`
- L29: `if (chmod(argv[1], argc == 5 ? 0666 : 0600) != 0 || listen(listener, 1) != 0) { perror("listen/chmod"); close(listener); unlink(ar`
- L38: `ssize_t written = write(client, reply, strlen(reply));`
- L43: `close(client);`
- L45: `close(listener); unlink(argv[1]); return result;`

### `cgroup-control-fd-qualification.c`
Function candidates: `main`.
Test modules referencing this source: **NONE IDENTIFIED**.
- L18: `int parent=open(argv[1],O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);`
- L21: `if(fstatfs(parent,&fs)||fs.f_type==CGROUP2_SUPER_MAGIC){close(parent);return 71;}`
- L22: `int leaf=openat(parent,argv[2],O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);`
- L23: `close(parent);`
- L25: `if(fstatfs(leaf,&fs)||fs.f_type==CGROUP2_SUPER_MAGIC){close(leaf);return 71;}`
- L26: `int procs=openat(leaf,"cgroup.procs",O_RDWR|O_NOFOLLOW|O_CLOEXEC);`
- L27: `int events=openat(leaf,"cgroup.events",O_RDONLY|O_NOFOLLOW|O_CLOEXEC);`
- L28: `int kill=openat(leaf,"cgroup.kill",O_WRONLY|O_NOFOLLOW|O_CLOEXEC);`
- L30: `if(procs>=0)close(procs);`
- L31: `if(events>=0)close(events);`
- L32: `if(kill>=0)close(kill);`
- L33: `close(leaf);return 73;`
- L36: `if(fstat(procs,&a)||fstat(events,&b)||fstat(kill,&c)||`
- L38: `close(procs);close(events);close(kill);close(leaf);return 74;`
- L43: `if(ftruncate(procs,0)||write(procs,pid,strlen(pid))!=(ssize_t)strlen(pid)||`
- L45: `close(procs);close(events);close(kill);close(leaf);return 75;`
- L47: `char buf[32]={0};ssize_t n=read(procs,buf,sizeof(buf)-1);`
- L49: `close(procs);close(events);close(kill);close(leaf);return 76;`
- L52: `close(procs);close(events);close(kill);close(leaf);`

### `cgroup-dirfd-qualification.c`
Function candidates: `fail`, `main`, `pin_root`.
Test modules referencing this source: **NONE IDENTIFIED**.
- L17: `if(fd>=0)close(fd);`
- L27: `int parent=open("/",O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);`
- L37: `close(parent);return -1;`
- L41: `int next=openat(parent,name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);`
- L42: `close(parent);`
- L57: `if(fstat(root,&rs)||!S_ISDIR(rs.st_mode))return fail("root not directory",root);`
- L63: `int leaf=openat(root,argv[2],O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);`
- L64: `close(root);`
- L66: `if(fstat(leaf,&ls)||!S_ISDIR(ls.st_mode))return fail("leaf not directory",leaf);`
- L78: `int fd=openat(leaf,name,O_RDONLY|O_NOFOLLOW|O_CLOEXEC|O_NONBLOCK);`
- L81: `if(fstat(fd,&st)||!S_ISREG(st.st_mode)||`
- L83: `close(fd);return fail("control not trusted regular file",leaf);`
- L85: `close(fd);`
- L87: `close(leaf);`

### `cgroup-leaf-ownership-qualification.c`
Function candidates: `main`, `pin_root`, `valid_name`.
Test modules referencing this source: **NONE IDENTIFIED**.
- L23: `int parent=open("/",O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);`
- L31: `close(parent);return -1;`
- L34: `int next=openat(parent,name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);`
- L35: `close(parent);if(next<0)return -1;`
- L47: `if(fstat(parent,&root_stat)||!S_ISDIR(root_stat.st_mode)){`
- L48: `close(parent);return 70;`
- L54: `close(parent);return 76;`
- L60: `close(parent);return result;`
- L62: `int leaf=openat(parent,argv[2],O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);`
- L63: `if(leaf<0){close(parent);return 72;}`
- L66: `if(fstat(leaf,&st)||!S_ISDIR(st.st_mode)||st.st_uid!=geteuid()||`
- L69: `close(leaf);close(parent);return 74;`
- L76: `close(leaf);close(parent);return 75;`
- L80: `close(leaf);close(parent);`

### `cgroup-runtime-view-qualification.c`
Function candidates: `ack_exact`, `ack_phase`, `approval`, `bindings`, `bootstrap_child`, `budget_ok`, `child_setup`, `cleanup`, `cleanup_until`, `continue_child`, `control`, `control_custody`, `controllers`, `empty`, `empty_inner_remove`, `event`, `event_until`, `hex_string`, `inner_custody`, `intent`, `intent_text`, `join_child`, `known_children`, `limits`, `main`, `members`, `namespace_stat`, `open_inner`, `open_outer`, `open_regular`, `open_view`, `parent_single_outer`, `pidfd_alive`, `pidfd_state`, `pin_directory`, `pin_view`, `process_info`, `publish`, `read_fd`, `read_record`, `records_equal`, `regular_root`, `remove_record`, `reopen_inner`, `root_directory`, `same_inode`, `set_text`, `setup`, `spawn_child`, `stopped`, `sweep_empty`, `text_is`, `wait_injected_exit`, `wait_stop`, `write_all`.
Test modules referencing this source: `test_ge04_native_default_hold.py`, `test_ge04_runtime_view.py`.
- L77: `return budget_ok()&&fd>=0&&!fstat(fd,&s)&&S_ISDIR(s.st_mode)&&s.st_uid==0&&s.st_gid==0&&`
- L83: `strcpy(copy,path);int fd=open("/",O_RDONLY|O_DIRECTORY|O_CLOEXEC);`
- L84: `if(!root_directory(fd,0)){if(fd>=0)close(fd);return -1;}`
- L87: `if(!budget_ok()){close(fd);return -1;}`
- L88: `if(!strcmp(p,".")||!strcmp(p,"..")){close(fd);return -1;}`
- L89: `int next=openat(fd,p,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);close(fd);fd=next;`
- L90: `if(!root_directory(fd,0)){if(fd>=0)close(fd);return -1;}`
- L96: `return budget_ok()&&fd>=0&&!fstat(fd,&s)&&S_ISREG(s.st_mode)&&s.st_uid==0&&s.st_gid==0&&`
- L104: `ssize_t n=read(fd,out+used,cap-1-used);`
- L105: `if(n<0){if(errno==EINTR)continue;return 0;}`
- L113: `int fresh=openat(dir,name,flags|O_CREAT|O_EXCL|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC,mode);`
- L116: `close(fresh);return -1;`
- L122: `int metadata=openat(dir,name,O_PATH|O_NOFOLLOW|O_CLOEXEC);struct stat before,after;`
- L123: `if(!regular_root(metadata,mode,max)||fstat(metadata,&before)){`
- L124: `if(metadata>=0)close(metadata);`
- L127: `int fd=budget_ok()?openat(dir,name,flags|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC):-1;`
- L128: `int ok=regular_root(fd,mode,max)&&!fstat(fd,&after)&&same_inode(&before,&after);`
- L129: `close(metadata);`
- L130: `if(!ok){if(fd>=0)close(fd);return -1;}`
- L137: `int ok=read_fd(fd,out,cap)&&!fstat(fd,&s)&&(size_t)s.st_size==strlen(out);`
- L138: `close(fd);return ok;`
- L173: `int fd=openat(dir,name,flags|O_NOFOLLOW|O_CLOEXEC);struct stat s,base;struct statfs fs;`
- L175: `if(!budget_ok()||fstat(fd,&s)||fstat(dir,&base)||fstatfs(fd,&fs)||fs.f_type!=CGROUP2_SUPER_MAGIC||`
- L176: `!S_ISREG(s.st_mode)||s.st_uid||s.st_gid||(s.st_mode&0022)||s.st_dev!=base.st_dev){close(fd);return -1;}`
- L181: `return budget_ok()&&fd>=0&&!fstat(fd,&a)&&!fstatat(dir,name,&b,AT_SYMLINK_NOFOLLOW)&&same_inode(&a,&b)&&`
- L186: `int ok=read_fd(fd,text,sizeof(text))&&!strcmp(text,expected);close(fd);return ok;`
- L193: `written=write(fd,text,n);`
- L194: `}while(written<0&&errno==EINTR);`
- L195: `int ok=written==(ssize_t)n&&control_custody(dir,name,fd)&&budget_ok();close(fd);return ok;`
- L200: `int ok=read_fd(fd,text,sizeof(text));close(fd);if(!ok)return -1;`
- L212: `int ok=read_fd(fd,text,sizeof(text));close(fd);`
- L219: `if(!root_directory(work,1)||!root_directory(parent,0)||fstat(work,&s)||!same_inode(&s,&c->work_stat))goto out;`
- L220: `if(fstat(parent,&s)||!same_inode(&s,&c->parent_stat)||`
- L235: `if(work>=0)close(work);`
- L236: `if(parent>=0)close(parent);`
- L258: `do{n=poll(&p,1,(int)(until-now));}while(n<0&&errno==EINTR&&budget_ok());`
- L261: `do{used=read(STDIN_FILENO,&received,1);}while(used<0&&errno==EINTR&&budget_ok());`
- L265: `do{n=poll(&extra,1,0);}while(n<0&&errno==EINTR&&budget_ok());`
- L289: `ssize_t used=write(fd,data+off,n-off);if(used<0&&errno==EINTR)continue;`
- L297: `int fd=openat(c->work,"intent.tmp",O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);`
- L298: `if(!regular_root(fd,0600,sizeof(text)-1)){if(fd>=0)close(fd);return 0;}`
- L299: `int ok=write_all(fd,text,strlen(text))&&budget_ok()&&!fsync(fd)&&budget_ok();close(fd);if(!ok)return 0;`
- L301: `if(!budget_ok()||syscall(SYS_renameat2,c->work,"intent.tmp",c->work,"intent.v1",RENAME_NOREPLACE))return 0;`
- L305: `c->published=1;return budget_ok()&&fsync(c->work)==0&&bindings(c);`
- L310: `int fd=open(path,O_RDONLY|O_CLOEXEC|O_NOFOLLOW|O_NONBLOCK);if(fd<0)return 0;`
- L312: `close(fd);if(!ok)return 0;`
- L319: `fd=open(path,O_RDONLY|O_CLOEXEC|O_NOFOLLOW|O_NONBLOCK);if(fd<0)return 0;`
- L321: `close(fd);if(!ok)return 0;`
- L330: `do{n=poll(&p,1,0);}while(n<0&&errno==EINTR&&budget_ok());`
- L355: `if(got<0&&errno!=EINTR)return 0;`
- L382: `return syscall(SYS_pidfd_send_signal,c->pidfd[slot],SIGCONT,NULL,0)==0;`
- L390: `if(fstat(nullfd,&s)||!S_ISCHR(s.st_mode)||s.st_rdev!=makedev(1,3)||`
- L394: `if(syscall(SYS_close_range,second>=0?5U:4U,~0U,0))_exit(119);`
- L404: `if(unshare(CLONE_NEWNS|CLONE_NEWCGROUP))_exit(120);`
- L405: `if(mount(NULL,"/",NULL,MS_REC|MS_PRIVATE,NULL))_exit(121);`
- L407: `if(mount("none","/sys/fs/cgroup","cgroup2",MS_NOSUID|MS_NODEV|MS_NOEXEC,NULL))_exit(123);`
- L408: `if(write(3,"0",1)!=1)_exit(124);`
- L409: `close(3);`
- L415: `if(setns(4,CLONE_NEWCGROUP)||setns(3,CLONE_NEWNS))_exit(126);`
- L416: `close(3);close(4);`
- L428: `int nullfd=open("/dev/null",O_RDWR|O_NOFOLLOW|O_CLOEXEC|O_NOCTTY);struct stat s;`
- L430: `if(fstat(nullfd,&s)||!S_ISCHR(s.st_mode)||s.st_uid||s.st_gid||s.st_rdev!=makedev(1,3)){close(nullfd);return 0;}`
- L432: `if(source<0){close(nullfd);return 0;}`
- L433: `int high[3]={-1,-1,-1};high[0]=fcntl(nullfd,F_DUPFD_CLOEXEC,16);`
- L434: `high[1]=fcntl(source,F_DUPFD_CLOEXEC,16);`
- L435: `if(slot==1)high[2]=fcntl(c->ns[1],F_DUPFD_CLOEXEC,16);`
- L436: `close(nullfd);if(slot==0)close(source);`
- L439: `if(!valid){for(int i=0;i<3;i++)if(high[i]>=0)close(high[i]);return 0;}`
- L441: `if(!budget_ok()){for(int i=0;i<3;i++)if(high[i]>=0)close(high[i]);return 0;}`
- L445: `c->child[slot]=(pid_t)syscall(SYS_clone3,&args,sizeof(args));`
- L454: `for(int i=0;i<3;i++)if(high[i]>=0)close(high[i]);`
- L463: `int fd=open(path,O_RDONLY|O_DIRECTORY|O_CLOEXEC);struct stat s;struct statfs fs;`
- L465: `if(fstat(fd,&s)||fstatfs(fd,&fs)||fs.f_type!=CGROUP2_SUPER_MAGIC||!same_inode(&s,&c->outer_stat)){`
- L466: `close(fd);return 0;`
- L475: `int fd=open(path,O_RDONLY|O_CLOEXEC);struct statfs fs;struct stat host;`
- L478: `if(fstat(fd,&c->ns_stat[i])||fstatfs(fd,&fs)||fs.f_type!=NSFS_MAGIC||`
- L479: `ioctl(fd,NS_GET_NSTYPE)!=kinds[i]||!namespace_stat(getpid(),names[i],&host)||`
- L490: `int ok=read_fd(fd,text,sizeof(text));close(fd);if(!ok)return 0;`
- L503: `return root_directory(*fd,1)&&!fstat(*fd,saved)&&saved->st_dev==c->outer_stat.st_dev&&`
- L508: `int copy=openat(dir,".",O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(copy<0)return 0;`
- L509: `DIR *d=fdopendir(copy);if(!d){close(copy);return 0;}struct dirent *e;int ok=1;`
- L562: `if(lseek(c->killfd,0,SEEK_SET)<0||write(c->killfd,"1",1)!=1)return 0;`
- L569: `if(got<0&&errno!=ECHILD&&errno!=EINTR)return 0;`
- L577: `if(c->view[i]>=0){close(c->view[i]);c->view[i]=-1;}`
- L578: `if(c->ns[i]>=0){close(c->ns[i]);c->ns[i]=-1;}`
- L589: `return bindings(c)&&remove_record(c,"intent.tmp")&&budget_ok()&&fsync(c->work)==0&&budget_ok();`
- L597: `if(!root_directory(c->work,1)||fstat(c->work,&c->work_stat)||fstatfs(c->work,&workfs)||`
- L600: `if(!regular_root(c->lock,0600,0)||fstat(c->lock,&c->lock_stat))return 0;`
- L606: `if(c->parent<0||fstat(c->parent,&c->parent_stat)||fstatfs(c->parent,&fs)||fs.f_type!=CGROUP2_SUPER_MAGIC||`
- L613: `c->outer=openat(c->parent,c->record.name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);`
- L615: `if(!root_directory(c->outer,1)||fstat(c->outer,&c->outer_stat)||fstatfs(c->outer,&fs)||`
- L633: `int copy=openat(c->parent,".",O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(copy<0)return -1;`
- L634: `DIR *d=fdopendir(copy);if(!d){close(copy);return -1;}struct dirent *e;int count=0,keeper=0;unsigned scanned=0;`
- L677: `return budget_ok()&&fsync(c->work)==0&&budget_ok();`
- L685: `if(got<0&&errno!=EINTR)return 0;`
- L725: `int initial=openat(c.parent,c.record.name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);`
- L726: `if(initial<0||fstat(initial,&s)){if(initial>=0)close(initial);goto finished;}close(initial);`
- L750: `errno=0;c.reason=write(-1,"+cpu",4)==-1&&errno==EBADF?"ENABLE_EBADF":"INJECTION_FAILED";goto rollback;`
- L775: `for(size_t i=0;i<sizeof(fds)/sizeof(fds[0]);i++)if(fds[i]>=0)close(fds[i]);`

### `cgroup-worker-qualification.c`

> **SUPERSEDED SECTION — DO NOT AUDIT CURRENT SOURCE FROM THESE LINES.** The function candidates and 57 sensitive-site citations below apply only to `5362bdb0b08586f51151f0b53519a48ababb557f9c31758283f3aab2ec06d757` at `d6e22669`. Current HIGH-1/HIGH-2 committed source `db3853acecc9f91c6a0c6aa594caeefeac5b80e3c735cea0d9fac873623c4e3e` adds root:root predicates and durable sweep admission; its current lexical function inventory and sensitive-site citations are in `docs/security/ge04-b1a-worker-authority-current-index.md`, and require independent review before A.03 acceptance.
Function candidates: `approval`, `bindings`, `cleanup`, `control`, `control_custody`, `empty`, `event`, `hex_string`, `intent_text`, `main`, `members`, `no_worker_directories`, `open_controls`, `open_recorded_leaf`, `pidfd_alive`, `pin_directory`, `process_info`, `publish`, `read_fd`, `read_intent`, `read_record_file`, `records_equal`, `regular_root`, `remove_artifact`, `root_directory`, `same_inode`, `setup`, `stat_info`, `sweep_empty`, `wait_running`, `wait_stopped`, `worker`, `write_all`.
Test modules referencing this source: `test_ge04_cgroup_worker.py`.
- L56: `return fd>=0&&!fstat(fd,&s)&&S_ISDIR(s.st_mode)&&s.st_uid==0&&!(s.st_mode&0022);`
- L61: `strcpy(copy,path);int fd=open("/",O_RDONLY|O_DIRECTORY|O_CLOEXEC);`
- L62: `if(!root_directory(fd)){if(fd>=0)close(fd);return -1;}`
- L65: `if(!strcmp(p,".")||!strcmp(p,"..")){close(fd);return -1;}`
- L66: `int next=openat(fd,p,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);close(fd);fd=next;`
- L67: `if(!root_directory(fd)){if(fd>=0)close(fd);return -1;}`
- L73: `return fd>=0&&!fstat(fd,&s)&&S_ISREG(s.st_mode)&&s.st_uid==0&&s.st_nlink==1&&`
- L80: `ssize_t n=read(fd,out+used,cap-1-used);`
- L81: `if(n<0){if(errno==EINTR)continue;return 0;}`
- L87: `int fd=openat(dir,name,O_RDONLY|O_NOFOLLOW|O_CLOEXEC);`
- L88: `if(!regular_root(fd,0600,cap-1)){if(fd>=0)close(fd);return 0;}`
- L90: `int ok=read_fd(fd,out,cap)&&!fstat(fd,&st)&&(size_t)st.st_size==strlen(out);`
- L91: `close(fd);return ok;`
- L125: `int fd=openat(leaf,name,flags|O_NOFOLLOW|O_CLOEXEC);struct stat s,base;struct statfs fs;`
- L126: `if(fd<0||fstat(fd,&s)||fstat(leaf,&base)||fstatfs(fd,&fs)||fs.f_type!=CGROUP2_SUPER_MAGIC||`
- L127: `!S_ISREG(s.st_mode)||s.st_uid!=0||(s.st_mode&0022)||s.st_dev!=base.st_dev){if(fd>=0)close(fd);return -1;}`
- L138: `return fd>=0&&!fstat(fd,&pinned)&&!fstatat(dir,name,&named,AT_SYMLINK_NOFOLLOW)&&`
- L144: `int ok=fd>=0&&!fstat(fd,&s)&&(s.st_mode&0777)==0700&&same_inode(&s,&c->work_stat);if(fd>=0)close(fd);`
- L147: `fd=pin_directory(PARENT);ok=fd>=0&&!fstat(fd,&s)&&same_inode(&s,&c->parent_stat);if(fd>=0)close(fd);`
- L181: `if(n<0&&errno==EINTR)continue;`
- L184: `return read(0,&command,1)==1&&command=='c';`
- L189: `while(offset<n){ssize_t k=write(fd,data+offset,n-offset);if(k<0&&errno==EINTR)continue;if(k<=0)return 0;offset+=(size_t)k;}`
- L194: `int fd=openat(c->work,"intent.tmp",O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);`
- L196: `int ok=write_all(fd,text,strlen(text))&&!fsync(fd);close(fd);`
- L200: `if(syscall(SYS_renameat2,c->work,"intent.tmp",c->work,"intent.v1",RENAME_NOREPLACE))return 0;`
- L206: `errno=0;if(fsync(-1)!=-1||errno!=EBADF)return 0;`
- L209: `return fsync(c->work)==0;`
- L213: `snprintf(path,sizeof(path),"/proc/%ld/stat",(long)pid);fd=open(path,O_RDONLY|O_CLOEXEC|O_NOFOLLOW);`
- L215: `int ok=read_fd(fd,text,sizeof(text));close(fd);if(!ok)return 0;`
- L226: `snprintf(path,sizeof(path),"/proc/%ld/status",(long)pid);fd=open(path,O_RDONLY|O_CLOEXEC|O_NOFOLLOW);`
- L228: `ok=read_fd(fd,text,sizeof(text));close(fd);if(!ok)return 0;`
- L274: `int nullfd=open("/dev/null",O_RDWR|O_NOFOLLOW|O_CLOEXEC);struct stat s;`
- L275: `if(nullfd<0||fstat(nullfd,&s)||!S_ISCHR(s.st_mode)||s.st_uid!=0||s.st_rdev!=makedev(1,3))_exit(125);`
- L278: `if(syscall(SYS_close_range,3U,~0U,0))_exit(125);`
- L285: `pid_t descendant=fork();if(descendant<0)_exit(125);`
- L311: `if(lseek(c->killfd,0,SEEK_SET)<0||write(c->killfd,"1",1)!=1)return 0;`
- L328: `if(!remove_artifact(c,"intent.v1")||!remove_artifact(c,"intent.tmp")||fsync(c->work))return 0;`
- L332: `int fd=openat(c->parent,".",O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(fd<0)return 0;`
- L333: `DIR *dir=fdopendir(fd);if(!dir){close(fd);return 0;}struct dirent *e;int ok=1;`
- L342: `if(c->work<0||fstat(c->work,&c->work_stat)||(c->work_stat.st_mode&0777)!=0700)return 0;`
- L343: `c->lock=openat(c->work,".lock",O_RDWR|O_CREAT|O_NOFOLLOW|O_CLOEXEC,0600);`
- L351: `if(c->parent<0||fstat(c->parent,&c->parent_stat)||fstatfs(c->parent,&fs)||fs.f_type!=CGROUP2_SUPER_MAGIC||`
- L354: `int fd=control(c->parent,"cgroup.procs",O_RDONLY);char text[64];int ok=fd>=0&&read_fd(fd,text,sizeof(text))&&!text[0];if(fd>=0)clo`
- L358: `c->leaf=openat(c->parent,c->record.name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);`
- L360: `if(!root_directory(c->leaf)||fstat(c->leaf,&c->leaf_stat)||fstatfs(c->leaf,&fs)||fs.f_type!=CGROUP2_SUPER_MAGIC||`
- L377: `int copy=openat(c->parent,".",O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(copy<0)return 0;`
- L378: `DIR *dir=fdopendir(copy);if(!dir){close(copy);return 0;}struct dirent *e;int ok=1;`
- L388: `close(c->procs);close(c->events);close(c->killfd);close(c->leaf);c->procs=c->events=c->killfd=c->leaf=-1;`
- L398: `return fsync(c->work)==0;`
- L426: `c.leaf=openat(c.parent,c.record.name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);`
- L427: `if(!root_directory(c.leaf)||fstat(c.leaf,&c.leaf_stat))goto finished;`
- L440: `c.child=(pid_t)syscall(SYS_clone3,&args,sizeof(args));`
- L451: `errno=0;if(write(-1,"0",1)!=-1||errno!=EBADF)reason="INJECTION_FAILED";else reason="ATTACH_EBADF";goto rollback;`
- L456: `if(!bindings(&c)||!pidfd_alive(c.pidfd)||lseek(c.procs,0,SEEK_SET)<0||write(c.procs,pid,(size_t)n)!=n||`
- L467: `errno=0;if(syscall(SYS_pidfd_send_signal,-1,SIGCONT,NULL,0)!=-1||errno!=EBADF)reason="INJECTION_FAILED";else reason="RESUME_EBADF"`
- L469: `if(syscall(SYS_pidfd_send_signal,c.pidfd,SIGCONT,NULL,0))goto rollback;`
- L481: `for(size_t i=0;i<sizeof(fds)/sizeof(fds[0]);i++)if(fds[i]>=0)close(fds[i]);`

### `cgroup2-fixed-preflight.c`
Function candidates: `inspect`, `main`.
Test modules referencing this source: **NONE IDENTIFIED**.
- L15: `int fd = name ? openat(root_fd,name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC) : dup(root_fd);`
- L18: `if(fstat(fd,&st)||fstatfs(fd,&fs)||fs.f_type!=CGROUP2_SUPER_MAGIC||`
- L19: `!S_ISDIR(st.st_mode)||st.st_uid!=0||(st.st_mode&0022)){close(fd);return 72;}`
- L20: `int procs=openat(fd,"cgroup.procs",O_RDONLY|O_NOFOLLOW|O_CLOEXEC);`
- L21: `int events=openat(fd,"cgroup.events",O_RDONLY|O_NOFOLLOW|O_CLOEXEC);`
- L24: `if(procs>=0)close(procs);`
- L25: `if(events>=0)close(events);`
- L26: `close(fd);return 73;`
- L28: `int ok=!fstat(procs,&ps)&&S_ISREG(ps.st_mode)&&ps.st_uid==0&&ps.st_dev==st.st_dev;`
- L29: `if(events>=0)ok=ok&&!fstat(events,&es)&&S_ISREG(es.st_mode)&&es.st_uid==0&&es.st_dev==st.st_dev;`
- L30: `close(procs);if(events>=0)close(events);close(fd);`
- L37: `int slash=open("/",O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);`
- L39: `int sys=openat(slash,"sys",O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);close(slash);`
- L41: `int fs=openat(sys,"fs",O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);close(sys);`
- L43: `int cgroup=openat(fs,"cgroup",O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);close(fs);`
- L47: `close(cgroup);`

### `cgroup2-mount-preflight.c`
Function candidates: `main`.
Test modules referencing this source: **NONE IDENTIFIED**.
- L17: `int fd=open("/",O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);`
- L25: `close(fd);return 71;`
- L28: `int next=openat(fd,name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);`
- L29: `close(fd);if(next<0)return 72;`
- L33: `if(fstat(fd,&st)||fstatfs(fd,&fs)||!S_ISDIR(st.st_mode)||`
- L35: `close(fd);return 73;`
- L37: `int procs=openat(fd,"cgroup.procs",O_RDONLY|O_NOFOLLOW|O_CLOEXEC);`
- L38: `int events=openat(fd,"cgroup.events",O_RDONLY|O_NOFOLLOW|O_CLOEXEC);`
- L42: `if(procs>=0)close(procs);`
- L43: `if(events>=0)close(events);`
- L44: `close(fd);return 74;`
- L47: `int valid=!fstat(procs,&ps)&&S_ISREG(ps.st_mode)&&`
- L49: `if(events>=0)valid=valid&&!fstat(events,&es)&&S_ISREG(es.st_mode)&&`
- L51: `close(procs);if(events>=0)close(events);close(fd);`

### `diagnostic-fd-wait.c`
Function candidates: `fail`, `ge04_diagnostic_wait_fd`, `ge04_diagnostic_wait_fd_cancel`.
Test modules referencing this source: `test_ge04_diagnostic_fd_wait.py`.
- L18: `int flags = fcntl(fd, F_GETFL);`
- L20: `if (!(flags & O_NONBLOCK)) return fail(d, EPERM);`
- L23: `int cf = fcntl(cancel_fd, F_GETFL);`
- L25: `if (!(cf & O_NONBLOCK)) return fail(d, EPERM);`
- L40: `if (r < 0 && errno == EINTR) continue;`

### `isolated-worker-launcher.c`
Function candidates: `close_inherited_fds`, `die`, `main`, `pin_executable`, `trusted_directory`.
Test modules referencing this source: **NONE IDENTIFIED**.
- L33: `if(fstat(fd,&st)||!S_ISDIR(st.st_mode)||st.st_uid!=0||(st.st_mode&0022))`
- L41: `int parent=open("/",O_PATH|O_DIRECTORY|O_CLOEXEC);`
- L57: `int next=(int)syscall(SYS_openat2,parent,component,&how,sizeof(how));`
- L60: `close(parent);parent=next;`
- L64: `int fd=(int)syscall(SYS_openat2,parent,component,&how,sizeof(how));`
- L67: `if(fstat(fd,&st)||!S_ISREG(st.st_mode)||st.st_uid!=0||`
- L70: `close(parent);`
- L84: `if(preserve>3 && syscall(SYS_close_range,3U,(unsigned int)preserve-1,0))`
- L86: `if(syscall(SYS_close_range,(unsigned int)preserve+1,~0U,0)==0)return;`
- L126: `syscall(SYS_execveat,executable_fd,"",args,env,AT_EMPTY_PATH);`

### `isolated_job_signal_worker.py`
Function candidates: `main`, `no_duplicates`.
Test modules referencing this source: **NONE IDENTIFIED**.
- L26: `raw = sys.stdin.buffer.read(MAX_REQUEST + 1)`
- L57: `sys.stdout.buffer.write(encoded)`

### `isolated_phase_observer_worker.py`
Function candidates: `main`.
Test modules referencing this source: **NONE IDENTIFIED**.
- L21: `raw = sys.stdin.buffer.read(LIMIT + 1)`
- L43: `sys.stdout.buffer.write(payload)`

### `nonexecuting-sender-contract.c`
Function candidates: `ge04_sender_contract_can_ack`, `ge04_sender_contract_can_send`, `ge04_sender_contract_init`, `ge04_sender_contract_observe`, `quarantine`.
Test modules referencing this source: `test_ge04_nonexecuting_sender_contract.py`.
- L8: `errno = EPERM;`

### `pidfd-lifecycle-qualification.c`
Function candidates: `main`, `pinned_alive`, `send_pinned`.
Test modules referencing this source: **NONE IDENTIFIED**.
- L18: `return (int)syscall(SYS_pidfd_send_signal,fd,signal_number,NULL,0);`
- L35: `pid_t child=fork();`
- L40: `int fd=fail_open?-1:(int)syscall(SYS_pidfd_open,child,0);`
- L63: `if(kill(child,SIGKILL)<0 && errno!=ESRCH)result=82;`
- L67: `do {reaped=waitpid(child,&status,0);}while(reaped<0&&errno==EINTR);`
- L70: `if(fd>=0)close(fd);`

### `pidfd-qualification.c`
Function candidates: `main`, `parse_pid`.
Test modules referencing this source: **NONE IDENTIFIED**.
- L27: `int fd=(int)syscall(SYS_pidfd_open,pid,0);`
- L31: `if(status<0||status>0){close(fd);return 71;}`
- L38: `if(syscall(SYS_pidfd_send_signal,fd,sig,NULL,0)<0){perror("pidfd_send_signal");close(fd);return 72;}`
- L40: `close(fd);return 73;`
- L43: `close(fd);return 0;`

### `prebirth_fixture_journal.py`
Function candidates: `_fixture_directory`, `_read_exact_file`, `absent`, `inspect_fixture_journal`, `publish_fixture_once`, `publish_observed_fixture_once`.
Test modules referencing this source: `test_ge04_prebirth_fixture_journal.py`, `test_ge04_transaction_consumption_fixture.py`.
- L20: `info = os.fstat(fd)`
- L30: `fd = os.open(FILENAME, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK |`
- L33: `first = os.fstat(fd)`
- L41: `chunk = os.read(fd, min(256, MAX_RECORD + 1 - len(raw)))`
- L45: `second = os.fstat(fd)`
- L57: `os.close(fd)`
- L99: `fd = os.open(FILENAME, os.O_WRONLY | os.O_CREAT | os.O_EXCL |`
- L102: `issued_stat = os.fstat(fd)`
- L104: `if os.write(fd, raw) != len(raw):`
- L108: `os.fsync(fd)`
- L114: `current = os.fstat(directory)`
- L117: `os.fsync(directory)`
- L125: `if (os.fstat(directory).st_dev, os.fstat(directory).st_ino) != identity:`
- L132: `os.close(fd)`

### `protected-attempt-fence.c`
Function candidates: `deny`, `ge04_attempt_begin`, `ge04_attempt_close`, `ge04_attempt_custody_init`, `ge04_attempt_fence_encode`, `ge04_attempt_recheck`, `ge04_read_kernel_boot_id`, `is_root`.
Test modules referencing this source: `test_ge04_protected_cgroup_custody.py`, `test_ge04_protected_dispatch_intent.py`, `test_ge04_protected_keeper_custody.py`, `test_ge04_protected_mount_namespace.py`, `test_ge04_protected_native_journal.py`, `test_ge04_protected_systemd_birth_observer.py`, `test_ge04_protected_systemd_job_binding.py`, `test_ge04_protected_systemd_signal_dispatch.py`, `test_ge04_protected_systemd_transaction.py`.
- L22: `int fd = open("/proc/sys/kernel/random/boot_id",`
- L27: `do { count = read(fd, raw, sizeof(raw)); } while (count < 0 && errno == EINTR);`
- L29: `close(fd);`
- L59: `if (held->fence_fd >= 0) close(held->fence_fd);`
- L60: `if (held->directory_fd >= 0) close(held->directory_fd);`
- L98: `return deny(EPERM);`
- L103: `strcmp(boot, claim->boot_id) != 0) return deny(EPERM);`
- L105: `if (fstat(held->directory_fd, &dir) != 0 ||`
- L108: `fstat(held->fence_fd, &fd) != 0 ||`
- L118: `return deny(EPERM);`
- L124: `if (n < 0 && errno == EINTR) continue;`
- L136: `if (!is_root()) return deny(EPERM);`
- L153: `if (n < 0 && errno == EINTR) continue;`
- L170: `int fd = openat(dir, GE04_ATTEMPT_FILE,`
- L171: `O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW |`
- L173: `if (fd < 0) { close(dir); return -1; }`
- L174: `/* Any failure after O_EXCL leaves a permanent uncertain attempt. */`
- L180: `fstat(fd, &statbuf) == 0 && S_ISREG(statbuf.st_mode) &&`
- L185: `ssize_t n = write(fd, text + written, len - written);`
- L186: `if (n < 0 && errno == EINTR) continue;`
- L190: `if (written == len && fsync(fd) == 0 && fsync(dir) == 0) {`
- L202: `close(fd);`
- L203: `close(dir);`

### `protected-cgroup-custody.c`
Function candidates: `fixed_root_open`, `ge04_cgroup_custody_close`, `ge04_cgroup_custody_init`, `ge04_cgroup_pin_unqualified`, `ge04_cgroup_recheck_unqualified`, `name_binds`, `refuse`, `revalidate_chain`, `root_identity`, `same`, `snapshot`.
Test modules referencing this source: `test_ge04_protected_cgroup_custody.py`, `test_ge04_protected_mount_namespace.py`.
- L18: `static int refuse(void) { errno = EPERM; return -1; }`
- L38: `if (held->unit_fd >= 0) close(held->unit_fd);`
- L39: `if (held->slice_fd >= 0) close(held->slice_fd);`
- L40: `if (held->root_fd >= 0) close(held->root_fd);`
- L55: `if (fstat(fd, &st) < 0 || fstatfs(fd, &fs) < 0 ||`
- L59: `statx(fd, "", AT_EMPTY_PATH | AT_SYMLINK_NOFOLLOW,`
- L80: `fstat(pinned, &target) < 0 || !S_ISDIR(st.st_mode))`
- L92: `close(current_fd);`
- L113: `int slash = open("/", flags);`
- L115: `int sys = openat(slash, "sys", flags);`
- L116: `close(slash);`
- L118: `int fs = openat(sys, "fs", flags);`
- L119: `close(sys);`
- L121: `int root = openat(fs, "cgroup", flags);`
- L122: `close(fs);`
- L161: `candidate.slice_fd = openat(candidate.root_fd, "system.slice", flags);`
- L163: `candidate.unit_fd = openat(candidate.slice_fd, GE04_PREBIRTH_UNIT, flags);`
- L183: `if (candidate.unit_fd >= 0) close(candidate.unit_fd);`
- L184: `if (candidate.slice_fd >= 0) close(candidate.slice_fd);`
- L185: `if (candidate.root_fd >= 0) close(candidate.root_fd);`

### `protected-dispatch-intent.c`
Function candidates: `ge04_dispatch_intent_close`, `ge04_dispatch_intent_encode`, `ge04_dispatch_intent_init`, `ge04_dispatch_intent_recheck`, `ge04_dispatch_intent_stage`, `manager_name`, `matches_prepared`, `refuse`, `root_identity`.
Test modules referencing this source: `test_ge04_protected_dispatch_hold.py`, `test_ge04_protected_dispatch_intent.py`.
- L68: `if (held->intent_fd >= 0) close(held->intent_fd);`
- L69: `if (held->directory_fd >= 0) close(held->directory_fd);`
- L79: `return refuse(EPERM);`
- L83: `return refuse(EPERM);`
- L85: `if (fstat(held->directory_fd, &dir) < 0 ||`
- L88: `fstat(held->intent_fd, &descriptor) < 0 ||`
- L100: `return refuse(EPERM);`
- L106: `if (got < 0 && errno == EINTR) continue;`
- L122: `const char *dest = sd_bus_message_get_destination(m);`
- L123: `const char *path = sd_bus_message_get_path(m);`
- L124: `const char *iface = sd_bus_message_get_interface(m);`
- L125: `const char *member = sd_bus_message_get_member(m);`
- L126: `return sd_bus_message_get_bus(m) == tx->bus &&`
- L131: `sd_bus_message_has_signature(m, FIXED_SIGNATURE) == 1;`
- L157: `int file = openat(directory, GE04_DISPATCH_INTENT_FILE,`
- L158: `O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW |`
- L160: `if (file < 0) { close(directory); goto reject; }`
- L166: `if (fstat(file, &info) == 0 && S_ISREG(info.st_mode) &&`
- L171: `ssize_t n = write(file, text + written, length - written);`
- L172: `if (n < 0 && errno == EINTR) continue;`
- L176: `if (written == length && fsync(file) == 0 &&`
- L177: `fsync(directory) == 0) {`
- L191: `close(file);`
- L192: `close(directory);`
- L195: `return refuse(EPERM);`

### `protected-dispatch-preparation.c`
Function candidates: `expected_headers`, `ge04_dispatch_prepared`, `ge04_prepare_fixed_dispatch`, `ge04_prepared_dispatch_close`, `ge04_prepared_dispatch_init`, `refuse`, `root_identity`.
Test modules referencing this source: `test_ge04_protected_dispatch_hold.py`, `test_ge04_protected_dispatch_intent.py`, `test_ge04_protected_dispatch_preparation.py`.
- L18: `errno = EPERM;`
- L33: `sd_bus_message_unref(out->message);`
- L38: `const char *destination = sd_bus_message_get_destination(message);`
- L39: `const char *path = sd_bus_message_get_path(message);`
- L40: `const char *interface = sd_bus_message_get_interface(message);`
- L41: `const char *member = sd_bus_message_get_member(message);`
- L42: `return sd_bus_message_get_bus(message) == tx->bus &&`
- L47: `sd_bus_message_has_signature(message, EXPECTED_SIGNATURE) == 1;`
- L65: `int r = sd_bus_message_new_method_call(`
- L69: `sd_bus_message_unref(message);`
- L75: `sd_bus_message_unref(message);`

### `protected-keeper-custody.c`
Function candidates: `alive`, `denied`, `ge04_keeper_custody_close`, `ge04_keeper_custody_init`, `ge04_keeper_pin_unqualified`, `ge04_keeper_recheck_unqualified`, `parse_startticks`, `read_proc`, `root_identity`, `sample`.
Test modules referencing this source: `test_ge04_protected_cgroup_custody.py`, `test_ge04_protected_keeper_custody.py`, `test_ge04_protected_mount_namespace.py`.
- L22: `static int denied(void) { errno = EPERM; return -1; }`
- L37: `if (held->held == 1 && held->pidfd >= 0) close(held->pidfd);`
- L47: `int fd = open(path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC);`
- L50: `int ok = fstat(fd, &st) == 0 && S_ISREG(st.st_mode);`
- L53: `ssize_t got = read(fd, out + offset, cap - offset);`
- L54: `if (got < 0 && errno == EINTR) continue;`
- L60: `ssize_t next = read(fd, &extra, 1);`
- L63: `close(fd);`
- L156: `int fd = (int)syscall(SYS_pidfd_open, (pid_t)view.main_pid, 0u);`
- L166: `if (!valid) { close(fd); return denied(); }`

### `protected-mount-namespace.c`
Function candidates: `decimal_id`, `deny`, `ge04_mount_namespace_close`, `ge04_mount_namespace_init`, `ge04_mount_namespace_pin_unqualified`, `ge04_mount_namespace_recheck_unqualified`, `mountinfo_matches`, `namespace_id`, `open_keeper_namespace`, `parse_mountinfo`, `root_identity`.
Test modules referencing this source: `test_ge04_protected_mount_namespace.py`.
- L18: `static int deny(void) { errno = EPERM; return -1; }`
- L37: `if (held->keeper_ns_fd >= 0) close(held->keeper_ns_fd);`
- L38: `if (held->controller_ns_fd >= 0) close(held->controller_ns_fd);`
- L124: `int fd = open(path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC);`
- L130: `ssize_t got = read(fd, bytes + size, sizeof(bytes) - size);`
- L131: `if (got < 0 && errno == EINTR) continue;`
- L138: `if (read(fd, &extra, 1) != 0) ok = 0;`
- L140: `close(fd);`
- L145: `if (fd < 0 || fstat(fd, &st) < 0 || !st.st_dev || !st.st_ino)`
- L158: `return open(path, O_RDONLY | O_CLOEXEC);`
- L184: `close(fresh);`
- L204: `candidate.controller_ns_fd = open("/proc/self/ns/mnt", O_RDONLY | O_CLOEXEC);`
- L230: `if (candidate.controller_ns_fd >= 0) close(candidate.controller_ns_fd);`
- L231: `if (candidate.keeper_ns_fd >= 0) close(candidate.keeper_ns_fd);`

### `protected-prebirth-journal.c`
Function candidates: `exact_hex`, `ge04_open_protected_directory`, `ge04_prebirth_close`, `ge04_prebirth_custody_init`, `ge04_prebirth_encode`, `ge04_prebirth_recheck`, `ge04_prebirth_stage`, `original_file`, `read_all_at`, `refuse`, `reset_custody`, `root_parent_dir`, `root_private_dir`.
Test modules referencing this source: `test_ge04_protected_cgroup_custody.py`, `test_ge04_protected_dispatch_intent.py`, `test_ge04_protected_keeper_custody.py`, `test_ge04_protected_mount_namespace.py`, `test_ge04_protected_native_journal.py`, `test_ge04_protected_systemd_birth_observer.py`, `test_ge04_protected_systemd_job_binding.py`, `test_ge04_protected_systemd_signal_dispatch.py`, `test_ge04_protected_systemd_transaction.py`.
- L62: `if (fd < 0 || fstat(fd, &s) != 0 || !S_ISDIR(s.st_mode) ||`
- L65: `return refuse(EPERM);`
- L71: `if (fd < 0 || fstat(fd, &s) != 0 || !S_ISDIR(s.st_mode) ||`
- L74: `return refuse(EPERM);`
- L79: `if (fd < 0 || fstat(fd, result) != 0 ||`
- L84: `return refuse(EPERM);`
- L103: `if (custody->journal_fd >= 0) close(custody->journal_fd);`
- L104: `if (custody->directory_fd >= 0) close(custody->directory_fd);`
- L111: `return refuse(EPERM);`
- L112: `int root = open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);`
- L114: `if (root >= 0) close(root);`
- L117: `int var = openat(root, "var",`
- L119: `close(root);`
- L121: `if (var >= 0) close(var);`
- L124: `int lib = openat(var, "lib",`
- L126: `close(var);`
- L128: `if (lib >= 0) close(lib);`
- L131: `int dir = openat(lib, "alix-ge04",`
- L133: `close(lib);`
- L135: `if (dir >= 0) close(dir);`
- L146: `if (read_bytes < 0 && errno == EINTR) continue;`
- L160: `return refuse(EPERM);`
- L174: `return refuse(EPERM);`
- L186: `return refuse(EPERM);`
- L192: `if (ge04_attempt_recheck(claim, attempt) != 0) return refuse(EPERM);`
- L207: `int fd = openat(dir, GE04_PREBIRTH_FILE,`
- L208: `O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC |`
- L211: `close(dir);`
- L219: `if (fstat(fd, &s) == 0 && S_ISREG(s.st_mode) &&`
- L224: `ssize_t n = write(fd, encoded + offset, length - offset);`
- L225: `if (n < 0 && errno == EINTR) continue;`
- L229: `if (offset == length && fsync(fd) == 0 && fsync(dir) == 0) {`
- L243: `close(fd);`
- L244: `close(dir);`

### `protected-systemd-birth-observer.c`
Function candidates: `deny`, `ge04_observe_unqualified_postbirth`, `get_exact_string`, `get_invocation`, `sample`.
Test modules referencing this source: `test_ge04_protected_cgroup_custody.py`, `test_ge04_protected_keeper_custody.py`, `test_ge04_protected_mount_namespace.py`, `test_ge04_protected_systemd_birth_observer.py`.
- L23: `errno = EPERM;`
- L31: `int r = sd_bus_get_property_string(bus, owner, FIXED_UNIT_PATH,`
- L40: `int r = sd_bus_get_property(bus, owner, FIXED_UNIT_PATH, UNIT_IFACE,`
- L43: `sd_bus_message_unref(reply);`
- L48: `r = sd_bus_message_read_array(reply, 'y', &bytes, &size);`
- L50: `sd_bus_message_unref(reply);`
- L62: `sd_bus_message_unref(reply);`
- L70: `int r = sd_bus_call_method(tx->bus, tx->owner, MANAGER_PATH,`
- L74: `sd_bus_message_unref(reply);`
- L77: `r = sd_bus_message_read(reply, "o", &path);`
- L80: `sd_bus_message_unref(reply);`
- L94: `if (sd_bus_get_property_trivial(tx->bus, tx->owner, FIXED_UNIT_PATH,`
- L97: `sd_bus_get_property_trivial(tx->bus, tx->owner, FIXED_UNIT_PATH,`

### `protected-systemd-request.c`
Function candidates: `exec_start`, `field`, `ge04_append_fixed_transient_request`.
Test modules referencing this source: `test_ge04_protected_dispatch_hold.py`, `test_ge04_protected_dispatch_intent.py`, `test_ge04_protected_systemd_request.py`.
- L11: `int r = sd_bus_message_open_container(m, 'r', "sv");`
- L13: `r = sd_bus_message_append(m, "s", name);`
- L15: `r = sd_bus_message_open_container(m, 'v', type);`
- L18: `r = sd_bus_message_append(m, "s", string_value);`
- L20: `r = sd_bus_message_append(m, "b", boolean_value);`
- L22: `r = sd_bus_message_close_container(m);`
- L24: `return sd_bus_message_close_container(m);`
- L28: `int r = sd_bus_message_open_container(m, 'r', "sv");`
- L30: `r = sd_bus_message_append(m, "s", "ExecStart");`
- L32: `r = sd_bus_message_open_container(m, 'v', "a(sasb)");`
- L34: `r = sd_bus_message_open_container(m, 'a', "(sasb)");`
- L36: `r = sd_bus_message_open_container(m, 'r', "sasb");`
- L38: `r = sd_bus_message_append(m, "s", GE04_KEEPER_CANDIDATE);`
- L40: `r = sd_bus_message_open_container(m, 'a', "s");`
- L42: `r = sd_bus_message_append(m, "s", GE04_KEEPER_CANDIDATE);`
- L44: `r = sd_bus_message_close_container(m);`
- L46: `r = sd_bus_message_append(m, "b", 0); /* ignore_failure=false */`
- L48: `r = sd_bus_message_close_container(m);`
- L50: `r = sd_bus_message_close_container(m);`
- L52: `r = sd_bus_message_close_container(m);`
- L54: `return sd_bus_message_close_container(m);`
- L62: `int r = sd_bus_message_append(m, "ss", GE04_PREBIRTH_UNIT, "fail");`
- L64: `r = sd_bus_message_open_container(m, 'a', "(sv)");`
- L76: `r = sd_bus_message_close_container(m);`
- L78: `r = sd_bus_message_open_container(m, 'a', "(sa(sv))");`
- L80: `return sd_bus_message_close_container(m); /* no auxiliary units */`

### `protected-systemd-transaction.c`
Function candidates: `apply_job_event`, `canonical_job_path`, `current_root_manager`, `deny`, `drain_pending`, `ge04_systemd_bind_job_reply`, `ge04_systemd_create_exclusive`, `ge04_systemd_recheck_original`, `ge04_systemd_subscribe_original`, `ge04_systemd_transaction_close`, `ge04_systemd_transaction_init`, `job_event`, `poison`, `root_identity`, `unique_owner`.
Test modules referencing this source: `test_ge04_protected_cgroup_custody.py`, `test_ge04_protected_dispatch_hold.py`, `test_ge04_protected_dispatch_intent.py`, `test_ge04_protected_keeper_custody.py`, `test_ge04_protected_mount_namespace.py`, `test_ge04_protected_systemd_birth_observer.py`, `test_ge04_protected_systemd_job_binding.py`, `test_ge04_protected_systemd_signal_dispatch.py`, `test_ge04_protected_systemd_transaction.py`.
- L42: `int r = sd_bus_get_name_creds(`
- L45: `if (r < 0) return deny(EPERM);`
- L46: `r = sd_bus_creds_get_unique_name(credentials, &owner);`
- L49: `sd_bus_creds_get_euid(credentials, &uid) < 0 ||`
- L51: `sd_bus_creds_unref(credentials);`
- L52: `return deny(EPERM);`
- L54: `sd_bus_creds_unref(credentials);`
- L82: `sd_bus_call_method(tx->bus, tx->owner, GE04_MANAGER_PATH,`
- L86: `sd_bus_slot_unref(tx->job_slot);`
- L87: `sd_bus_close_unref(tx->bus);`
- L105: `return deny(EPERM);`
- L143: `int r = sd_bus_message_read(message, "uoss", &id, &path, &unit, &result);`
- L145: `sd_bus_message_get_sender(message)) != 0)`
- L162: `if (sd_bus_message_get_reply_cookie(reply, &reply_cookie) < 0 ||`
- L164: `sd_bus_message_has_signature(reply, "o") != 1 ||`
- L165: `sd_bus_message_get_bus(reply) != tx->bus ||`
- L166: `sd_bus_message_get_type(reply, &type) < 0 ||`
- L168: `!sd_bus_message_get_sender(reply) ||`
- L169: `strcmp(sd_bus_message_get_sender(reply), tx->owner) != 0)`
- L172: `if (sd_bus_message_read(reply, "o", &path) < 0 || !path)`
- L203: `int r = sd_bus_process(tx->bus, NULL);`
- L206: `return deny(EPERM);`
- L211: `return deny(EPERM);`
- L221: `return deny(EPERM);`
- L228: `return deny(EPERM);`
- L238: `if (!root_identity()) return deny(EPERM);`
- L245: `return deny(EPERM);`
- L252: `int r = sd_bus_new(&bus);`
- L254: `r = sd_bus_set_address(bus, GE04_BUS_SOCKET);`
- L256: `r = sd_bus_set_bus_client(bus, 1);`
- L258: `r = sd_bus_set_method_call_timeout(bus, GE04_TIMEOUT_US);`
- L260: `r = sd_bus_start(bus);`
- L262: `r = sd_bus_get_name_creds(`
- L266: `r = sd_bus_creds_get_unique_name(credentials, &owner);`
- L268: `sd_bus_creds_get_euid(credentials, &uid) < 0 ||`
- L272: `sd_bus_creds_unref(credentials);`
- L278: `r = sd_bus_match_signal(bus, &slot, tx->owner, GE04_MANAGER_PATH,`
- L282: `r = sd_bus_call_method(bus, tx->owner, GE04_MANAGER_PATH,`
- L292: `return deny(EPERM);`
- L297: `sd_bus_creds_unref(credentials);`
- L298: `sd_bus_slot_unref(slot);`
- L299: `sd_bus_close_unref(bus);`
- L301: `return deny(EPERM);`
- L306: `return deny(EPERM); /* SECURITY HOLD: no StartTransientUnit */`

### `protected_approval_observer.py`
Function candidates: `_directory_chain`, `_protected_file`, `_safe_dir`, `corroborate_existing_approval`.
Test modules referencing this source: `test_ge04_protected_approval_observer.py`.
- L21: `info = os.fstat(fd)`
- L32: `fd = os.open("/", flags) if root_fd is None else os.dup(root_fd)`
- L39: `child = os.open(part, flags, dir_fd=fd)`
- L43: `os.close(child)`
- L45: `os.close(fd)`
- L49: `os.close(fd)`
- L54: `fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC |`
- L57: `first = os.fstat(fd)`
- L66: `chunk = os.read(fd, min(128, limit + 1 - len(raw)))`
- L70: `second = os.fstat(fd)`
- L81: `os.close(fd)`
- L128: `if ((os.fstat(second_work).st_dev, os.fstat(second_work).st_ino) !=`
- L129: `(os.fstat(work).st_dev, os.fstat(work).st_ino)`
- L130: `or (os.fstat(second_parent).st_dev, os.fstat(second_parent).st_ino) !=`
- L135: `os.close(second_parent)`
- L136: `os.close(second_work)`
- L149: `os.close(parent)`
- L151: `os.close(work)`

### `systemd_job_signal_observer.py`
Function candidates: `observe_fixed_job_signal`, `on_signal`, `on_timeout`.
Test modules referencing this source: `test_ge04_systemd_job_signal_observer.py`.
- L144: `bus.close()`

### `transaction_consumption_fixture.py`
Function candidates: `_existing_consumption`, `consume_packet_once`, `inspect_consumption_after_restart`.
Test modules referencing this source: `test_ge04_transaction_consumption_fixture.py`.
- L28: `fd = os.open(NAME, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK |`
- L31: `info = os.fstat(fd)`
- L36: `raw = os.read(fd, MAX_SIZE + 1)`
- L37: `now = os.fstat(fd)`
- L48: `os.close(fd)`
- L100: `# No up-front existence check: O_EXCL is the only name claim.`
- L101: `fd = os.open(NAME, os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW |`
- L104: `issued = os.fstat(fd)`
- L106: `if os.write(fd, raw) != len(raw):`
- L110: `os.fsync(fd)`
- L113: `os.fsync(directory)`
- L123: `if (os.fstat(directory).st_dev, os.fstat(directory).st_ino) != identity:`
- L146: `os.close(fd)`

### `unit_kernel_observer.py`
Function candidates: `_mount`, `_read_fixed`, `_scope`, `_stat_generation`, `observe_fixed_unit_kernel`, `observe_manager_and_kernel`, `proc_sample`.
Test modules referencing this source: `test_ge04_unit_kernel_observer.py`.
- L22: `fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK)`
- L24: `if not stat.S_ISREG(os.fstat(fd).st_mode):`
- L28: `chunk = os.read(fd, min(4096, cap + 1 - len(raw)))`
- L36: `os.close(fd)`
- L115: `pidfd = os.pidfd_open(pid, 0)`
- L130: `opened.append(os.open(ROOT, flags))`
- L132: `opened.append(os.open(part, flags, dir_fd=opened[-1]))`
- L134: `info = os.fstat(fd)`
- L139: `filefd = os.open("cgroup.procs", os.O_RDONLY | os.O_NOFOLLOW`
- L144: `chunk = os.read(filefd, min(4096, 4097 - len(members)))`
- L156: `os.close(filefd)`
- L158: `info = os.fstat(fd)`
- L163: `os.close(fd)`
- L174: `os.close(pidfd)`

### `worker-stream.c`
Function candidates: `check`, `close_owned`, `controls`, `decimal`, `fail`, `four_ids`, `ge04_stream_accept`, `ge04_stream_destroy`, `ge04_stream_read`, `ge04_stream_write`, `live`, `ready`, `receive_exact`, `restricted_ids`, `send_exact`, `small_file`, `start_ticks`, `zero_hex`.
Test modules referencing this source: `test_ge04_native_stream.py`.
- L21: `if(s->fd>=0)close(s->fd);`
- L22: `if(s->pidfd>=0)close(s->pidfd);`
- L42: `int fd=open(path,O_RDONLY|O_CLOEXEC|O_NOFOLLOW);`
- L46: `ssize_t n=read(fd,out+used,cap-1-used);`
- L47: `if(n<0){close(fd);return 0;}`
- L48: `if(!n){out[used]=0;close(fd);return 1;}`
- L51: `close(fd);return 0;`
- L132: `if(n<0){if(errno==EINTR)continue;return GE04_STREAM_DENIED;}`
- L145: `int listener_flags=fcntl(listener,F_GETFL),control_flags=fcntl(cancel_fd,F_GETFL);`
- L149: `(control_flags&O_ACCMODE)!=O_RDONLY||fstat(cancel_fd,&st)||!S_ISFIFO(st.st_mode)||`
- L164: `s->pidfd=(int)syscall(SYS_pidfd_open,p->pid,0);`
- L172: `if(errno!=EINTR&&errno!=EAGAIN&&errno!=EWOULDBLOCK)return fail(s,GE04_STREAM_DENIED);`
- L195: `int fd;memcpy(&fd,(char*)CMSG_DATA(c)+i,sizeof(fd));if(fd>=0)close(fd);`
- L212: `ssize_t n=recvmsg(s->fd,&msg,MSG_CMSG_CLOEXEC|MSG_DONTWAIT);`
- L213: `if(n<0){if(errno==EINTR||errno==EAGAIN||errno==EWOULDBLOCK)continue;return GE04_STREAM_DENIED;}`
- L241: `if(n<0){if(errno==EINTR||errno==EAGAIN||errno==EWOULDBLOCK)continue;return GE04_STREAM_DENIED;}`

## Mandatory independent review decision

For each sensitive site, record: entrypoint reachability, caller authority, input provenance, failure and partial-operation behavior, descriptor ownership, race/replay/crash behavior, exact negative test, reviewer verdict, and any remediation. Independently resolve macro/function-pointer edges and build-specific reachability. No absence of a test reference is waived.

**Blocking conditions:** no verified complete callgraph, no exhaustive per-branch negative test attestation, no independent human acceptance, no approved source/binary identity freeze. A.03 remains OPEN.
