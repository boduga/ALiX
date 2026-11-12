#!/usr/bin/env python3
"""M2.3 privilege transition source assertions, not independent security approval."""
import json
from pathlib import Path
import sys
root=Path(__file__).resolve().parents[1]
files={'launcher':'native/ge04/isolated-worker-launcher.c','worker_fixture':'native/ge04/cgroup-worker-qualification.c'}
checks={
 'launcher':['PR_SET_NO_NEW_PRIVS','setgroups(0,NULL)','setresgid(','setresuid(','getresuid(&ru,&eu,&su)','getresgid(&rg,&eg,&sg)','getgroups(0,NULL)!=0','su!=target','sg!=(gid_t)target','syscall(SYS_execveat'],
 'worker_fixture':['PR_SET_NO_NEW_PRIVS','setgroups(0,NULL)','setresgid(TEST_UID,TEST_UID,TEST_UID)','setresuid(TEST_UID,TEST_UID,TEST_UID)','getresuid(&ru,&eu,&su)','getresgid(&rg,&eg,&sg)','getgroups(0,NULL)!=0','su!=TEST_UID','sg!=TEST_UID','pid_t descendant=fork()']}
entries=[]
for label,path in files.items():
 lines=(root/path).read_text().splitlines()
 anchors=[]
 for needle in checks[label]:
  matches=[i+1 for i,line in enumerate(lines) if needle in line]
  assert matches,(label,needle)
  anchors.append({'fragment':needle,'lines':matches})
 entries.append({'fixture':label,'source':path,'anchors':anchors,
 'observed':'NO_NEW_PRIVS_THEN_CLEAR_GROUPS_THEN_DROP_REAL_EFFECTIVE_SAVED_IDS_THEN_VERIFY_ALL_IDS_AND_ZERO_GROUPS',
 'unresolved':['Kernel effective capability sets and securebits not independently measured',
               'No privileged negative-path injection or exec-time identity/capability attestation',
               'Launcher stopped-child handshake is not full parent-child authentication',
               'Proof that all inherited privilege-bearing descriptors are closed remains separate'],
 'review_verdict':'PENDING_INDEPENDENT_HUMAN_REVIEW'})
report={'scope':'MEDIUM-2 M2.3 PRIVILEGE TRANSITIONS', 'method':'AUTHOR_SOURCE_PINNING_NOT_PRIVILEGED_VALIDATION',
 'entries':entries,'security_hold':'ACTIVE',
 'limitations':'Source-shape assertions cannot prove kernel credential state, effective capabilities, or negative-path reachability.'}
out=root/'docs/security/ge04-b1a-privilege-transition-review.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'Privilege transition review drift'
print('GE-04 M2.3: 2 credential-drop paths source-pinned; kernel/capability proof and human verdict pending')
