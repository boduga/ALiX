#!/usr/bin/env python3
"""Source-pinned M2.1 crash/journal matrix; never an authority verdict."""
import json
from pathlib import Path
import sys
root=Path(__file__).resolve().parents[1]
paths={'worker':root/'native/ge04/cgroup-worker-qualification.c','view':root/'native/ge04/cgroup-runtime-view-qualification.c'}
checks={
 'worker':{
  'exclusive_temp_create':'openat(c->work,"intent.tmp",O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600)',
  'temp_file_sync':'write_all(fd,text,strlen(text))&&!fsync(fd)',
  'rename_no_replace':'RENAME_NOREPLACE',
  'directory_sync':'return fsync(c->work)==0;',
  'crash_leaf':'if(!strcmp(c.mode,"crash-leaf"))_exit(88);',
  'crash_temp':'if(!strcmp(c->mode,"crash-temp"))_exit(88);',
  'crash_intent':'if(!strcmp(c.mode,"crash-intent"))_exit(88);',
  'recovery_requires_intent':'if(!read_intent(c.work,"intent.v1",&r)',
  'sweep_requires_temp':'if(!sweep_candidate_allowed(has_temp,&pending,&st,e->d_name))',
  'temp_removal':'unlinkat(c->work,"intent.tmp",0)',
  'record_removal':'unlinkat(c->work,name,0)'},
 'view':{
  'exclusive_temp_create':'openat(c->work,"intent.tmp",O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600)',
  'temp_file_sync':'!fsync(fd)',
  'rename_no_replace':'RENAME_NOREPLACE',
  'directory_sync':'fsync(c->work)==0',
  'recovery_requires_intent':'if(!intent(c.work,"intent.v1",&r)',
  'sweep_requires_temp':'if(!has_temp||strcmp(name,pending.name)',
  'temp_removal':'unlinkat(c->work,"intent.tmp",0)',
  'record_removal':'unlinkat(c->work,name,0)'}}
risks={
 'pre_intent_leaf_birth':'A crash after mkdirat but before durable temp publication leaves a cgroup with no original intent. Current sweep refuses adoption; manual quarantine/cleanup required.',
 'temp_written_before_rename':'A canonical fsynced temp may allow tightly bound sweep; crash durability of the directory entry and parent cgroup birth is not independently established.',
 'rename_before_directory_fsync':'A crash can leave intent.v1 or intent.tmp or neither depending on filesystem persistence; no automatic inference of authorization from filename.',
 'record_validation_before_unlink':'Canonical contents and record equality do not atomically bind unlinkat to the verified inode; replacement requires independent writer-exclusion proof.',
 'leaf_deleted_before_record_cleanup':'Failure/crash can leave intent.v1 referencing an absent leaf; subsequent recover must quarantine rather than declare success without an owned leaf.',
 'post_unlink_before_directory_fsync':'Deletion can be rolled back by crash or leave partial records; replay must validate original durable authority and refuse ambiguous state.',
 'cooperating_lock_only':'flock serializes cooperating participants, not all privileged or alternate-mount writers.'}
entries=[]
for key,path in paths.items():
 lines=path.read_text().splitlines();anchors={}
 for name,needle in checks[key].items():
  matches=[i+1 for i,line in enumerate(lines) if needle in line]
  assert matches,(key,name,needle)
  anchors[name]={'line_numbers':matches,'fragment':needle}
 entries.append({'fixture':key,'source':str(path.relative_to(root)),'anchors':anchors,
 'unresolved_risks':risks,'review_verdict':'PENDING_INDEPENDENT_HUMAN_REVIEW'})
report={'scope':'MEDIUM-2 M2.1 JOURNAL REPLACEMENT AND CRASH RECOVERY',
 'method':'AUTHOR_SOURCE_ANCHORS_AND_FAILURE_STATE_HYPOTHESES',
 'entries':entries,'decision':'DO_NOT_ASSUME_CRASH_SAFE_OR_NAME_REPLACEMENT_SAFE',
 'limitations':'No privileged crash-injection execution, filesystem persistence proof, writer enumeration, or independent security verdict.'}
out=root/'docs/security/ge04-b1a-journal-recovery-review.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'Journal recovery review drift'
print('GE-04 M2.1 journal/recovery: 2 fixtures, 7 unresolved failure/race classes, independent verdict pending')
