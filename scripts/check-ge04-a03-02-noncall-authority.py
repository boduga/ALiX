#!/usr/bin/env python3
"""A03-02: pin noncall authority references to their actual effect paths.

This is an author trace, not an independent site-security verdict.
"""
import hashlib,json,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];BASE=ROOT/'native/ge04';DOC=ROOT/'docs/security'
REV='f748ea2e3030bec9d1e3fa375374663721e7496a'
g=json.loads((DOC/'ge04-a03-02-gcc-callsite-provenance.json').read_text())
queue=json.loads((DOC/'ge04-a03-02-gimple-reconciliation.json').read_text())
assert queue['authority_sites_without_same_line_gimple_call']==3
spec=[
 ('cgroup-runtime-view-qualification.c',443,'CLONE_INTO_CGROUP',445,'syscall','CLONE3_CGROUP_BIRTH'),
 ('cgroup-worker-qualification.c',482,'CLONE_INTO_CGROUP',484,'syscall','CLONE3_CGROUP_BIRTH'),
 ('worker-stream.c',189,'SCM_RIGHTS',195,'close','ANCILLARY_DESCRIPTOR_REJECTION'),
]
rows=[]
for name,refline,token,effectline,target,kind in spec:
 p=BASE/name;raw=p.read_bytes();old=subprocess.run(['git','show',f'{REV}:native/ge04/{name}'],cwd=ROOT,capture_output=True,check=True).stdout
 assert raw==old,name
 lines=raw.decode().splitlines()
 assert token in lines[refline-1],(name,refline)
 unit=next(e for e in g['entries'] if e['file']==name)
 effects=[c for c in unit['gimple_call_candidates'] if c['target_token']==target and any(loc['file']==name and loc['line']==effectline for loc in c['locations'])]
 assert effects,(name,effectline,target)
 rows.append({'file':name,'reference_line':refline,'reference_token':token,'reference_source':lines[refline-1].strip(),'effect_line':effectline,'effect_target':target,'effect_source':lines[effectline-1].strip(),'effect_gimple_candidates':len(effects),'effect_classification':kind,'review_status':'SOURCE_AND_COMPILER_EFFECT_LINKED_NOT_SECURITY_ADJUDICATED','sha256':hashlib.sha256(raw).hexdigest()})
assert {(e['file'],e['line']) for e in queue['unmatched_authority_sites']}=={(e['file'],e['reference_line']) for e in rows}
report={'scope':'A03-02 explicit noncall authority reference to effect crosswalk','reviewed_revision':REV,'previously_unmatched_authority_sites':3,'source_and_compiler_effect_links':3,'entries':rows,'status':'ALL_THREE_NONCALL_REFERENCES_LINKED_TO_EFFECT_PATHS; NOT_A_COMPLETE_SEMANTIC_AUDIT','limitations':['CLONE_INTO_CGROUP is an initializer flag; actual birth effect is later syscall','SCM_RIGHTS is a control-message discriminator; rejection effect closes received descriptors','Line-local crosswalk cannot prove authorization, ordering, negative paths or absence of other effects','A03-02 indirect calls, Python aliases, wrappers and unknown APIs still require analysis','A03-03 independent site-level security verdicts remain outstanding'],'security_hold':'ACTIVE'}
out=DOC/'ge04-a03-02-noncall-authority.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'A03-02 noncall authority drift'
print('A03-02 noncall authority: 3/3 flags and descriptor branches linked to compiler-visible effect paths; no site verdict')
