#!/usr/bin/env python3
"""Pinned, non-authorizing source evidence for destructive writer exclusion."""
import json
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'native/ge04'
OUT=ROOT/'docs/security/ge04-b1a-writer-exclusion-review.json'
SITES={
 'cgroup-worker-qualification.c':{
  'lock':'flock(c->lock,LOCK_EX|LOCK_NB)',
  'lock_inode_binding':'same_inode(&s,&c->lock_stat)',
  'work_owner':'root_directory_stat(&s)',
  'journal_delete':'unlinkat(c->work,name,0)',
  'leaf_delete':'unlinkat(c->parent,c->record.name,AT_REMOVEDIR)',
  'parent_custody':'same_inode(&s,&c->parent_stat)',
  'open_question':'Root-owned and non-group/world-writable ancestry limits ordinary unprivileged writers, but does not exclude root/CAP_DAC_OVERRIDE, privileged peer, alternate mount or cooperative-lock bypass; named unlink is not inode-conditional.'},
 'cgroup-runtime-view-qualification.c':{
  'lock':'flock(c->lock,LOCK_EX|LOCK_NB)',
  'lock_inode_binding':'same_inode(&s,&c->lock_stat)',
  'work_owner':'root_directory(c->work,1)',
  'journal_delete':'unlinkat(c->work,name,0)',
  'leaf_delete':'unlinkat(c->parent,c->record.name,AT_REMOVEDIR)',
  'parent_custody':'same_inode(&s,&c->parent_stat)',
  'open_question':'Root ownership and 0700 workdir are checked; parent cgroup write delegation and all privileged writers are not globally enumerated. flock only serializes cooperating holders; unlinkat does not compare inode at mutation.'}}
entries=[]
for filename,needles in SITES.items():
 lines=(BASE/filename).read_text().splitlines()
 evidence={}
 for kind,needle in needles.items():
  if kind=='open_question':continue
  matches=[i+1 for i,line in enumerate(lines) if needle in line]
  assert matches,(filename,kind,needle)
  evidence[kind]={'source_fragment':needle,'lines':matches}
 entries.append({'file':filename,'evidence':evidence,'risk':needles['open_question'],
 'writer_exclusion':'NOT_PROVEN','name_based_unlink_atomic_identity':'NOT_PROVEN',
 'independent_human_verdict':'PENDING_INDEPENDENT_HUMAN_REVIEW'})
report={'method':'AUTHOR_SOURCE_EVIDENCE_ONLY','entries':entries,
 'decision':'NO_NAME_BASED_DELETION_REWRITE_WITHOUT_REVIEWED_WRITER_EXCLUSION_OR_KERNEL_ATOMIC_IDENTITY_DESIGN',
 'limits':'Source grep pinning is not a semantic control-flow proof. No privileged tests or independent review.'}
if '--write' in sys.argv:OUT.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(OUT.read_text())==report,'Writer exclusion review drift'
print('GE-04 writer exclusion: 2/2 fixtures pinned; exclusion and atomic identity unproven')
