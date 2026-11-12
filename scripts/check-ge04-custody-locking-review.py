#!/usr/bin/env python3
"""M2.6 source-pinned custody and locking review; not human acceptance."""
import json
from pathlib import Path
import sys
root=Path(__file__).resolve().parents[1]
queue=json.loads((root/'docs/security/ge04-b1a-c-authority-review-queue.json').read_text())['entries']
sites=[e for e in queue if any(c['category']=='custody_and_locking' for c in e['security_checks'])]
assert len(sites)==8
checks={
 'native/ge04/cgroup-worker-qualification.c':['flock(c->lock,LOCK_EX|LOCK_NB)','same_inode(&s,&c->lock_stat)','same_inode(&s,&c->parent_stat)','O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC'],
 'native/ge04/cgroup-runtime-view-qualification.c':['flock(c->lock,LOCK_EX|LOCK_NB)','same_inode(&s,&c->lock_stat)','same_inode(&s,&c->parent_stat)','O_PATH|O_NOFOLLOW|O_CLOEXEC'],
 'native/ge04/protected-attempt-fence.c':['pread(held->fence_fd','pread(held->fence_fd, &trailer','held->owned != 1','fstatat(held->directory_fd','named.st_ino != fd.st_ino'],
 'native/ge04/protected-dispatch-intent.c':['pread(held->intent_fd','pread(held->intent_fd, &excess','held->owned != 1','fstatat(held->directory_fd','named.st_ino != descriptor.st_ino'],
 'native/ge04/protected-prebirth-journal.c':['pread(fd, bytes + offset','pread(fd, &trailer','O_CREAT | O_EXCL | O_NOFOLLOW','root_private_dir(custody->directory_fd, 0700)']}
paths=[]
for file,needles in checks.items():
 lines=(root/file).read_text().splitlines();anchors=[]
 for fragment in needles:
  matches=[i+1 for i,line in enumerate(lines) if fragment in line]
  assert matches,(file,fragment)
  anchors.append({'fragment':fragment,'lines':matches})
 paths.append({'file':file,'anchors':anchors,'human_verdict':'PENDING_INDEPENDENT_HUMAN_REVIEW'})
report={'scope':'MEDIUM-2 M2.6 CUSTODY AND LOCKING',
 'authority_sites':[{k:e[k] for k in ('file','line','apis','source')} for e in sites],
 'source_paths':paths,
 'observed':['Both cgroup fixtures take nonblocking exclusive advisory flock and recheck the named lock inode','Pinned parent/work and control descriptor identities are compared with named entries','Protected fence, dispatch intent, and prebirth journal use bounded positional reads and reject trailing bytes','Protected records use exclusive no-follow creation and retained descriptors'],
 'unresolved':['flock does not exclude uncooperative privileged writers, writable aliases, or alternate mount namespace views','name-based unlink and directory replacement remain non-atomic after identity recheck','the privileged writer set and file-system mount topology are not independently enumerated','pread validation does not make concurrently writable record content immutable','open-file-description lock inheritance and failure-path lifetime require runtime fault injection','privileged record creation/recovery and fsync durability need controlled crash tests'],
 'decision':'AUTHOR_SOURCE_REVIEW_ONLY; WRITER_EXCLUSION_AND_ATOMIC_IDENTITY_UNPROVEN',
 'independent_verdict':'PENDING_INDEPENDENT_HUMAN_REVIEW'}
out=root/'docs/security/ge04-b1a-custody-locking-review.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'Custody locking review drift'
print(f'GE-04 M2.6: {len(sites)} C authority sites and {len(paths)} source paths pinned; human verdict pending')
