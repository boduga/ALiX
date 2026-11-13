#!/usr/bin/env python3
"""M2.2 threat-model disposition; no inferred race-safety verdict."""
import json
from pathlib import Path
import sys
root=Path(__file__).resolve().parents[1]
inputs=['ge04-b1a-destructive-site-review.json','ge04-b1a-writer-exclusion-review.json','ge04-b1a-journal-recovery-review.json']
for name in inputs:assert (root/'docs/security'/name).is_file(),name
sites=json.loads((root/'docs/security'/inputs[0]).read_text())['entries']
mutations=[s for s in sites if 'removal' in s['operation']]
assert len(mutations)==8,[(s['file'],s['line'],s['operation']) for s in mutations]
rows=[]
for s in mutations:
 rows.append({'file':s['file'],'line':s['line'],'operation':s['operation'],
 'source':s['source'],'hazard':'NAME_BASED_UNLINK_AFTER_SEPARATE_CHECK',
 'precondition':'Independently establish exclusive write authority for every namespace/mount view of the parent until mutation; or redesign to avoid name-based identity race.',
 'author_decision':'NO_ATOMIC_IDENTITY_GUARANTEE_FROM_FSTATAT_PLUS_UNLINKAT',
 'independent_verdict':'PENDING_INDEPENDENT_HUMAN_REVIEW'})
report={'scope':'MEDIUM-2 M2.2 DESTRUCTIVE TOCTOU AND WRITER EXCLUSION',
 'inputs':inputs,'reviewed_named_removal_sites':rows,
 'threats':['uncooperative privileged writer with directory write access','replacement via alternate mount or namespace path','record substitution between canonical read and unlink','cgroup name substitution between fd custody check and rmdir','crash after mutation before directory fsync'],
 'confirmed_existing_controls':['pinned descriptors and directory ancestry checks','root-owned restrictive directories and regular files','cooperative exclusive flock','canonical intent and recorded inode comparisons','fail-closed quarantine on missing durable sweep intent'],
 'unproven_assumptions':['no privileged uncooperative writer can mutate parent','no writable alternate mount of same underlying directory','journal content and directory entry stable through unlink','filesystem persistence guarantees for interrupted birth and cleanup'],
 'safe_author_disposition':'DO_NOT_CLAIM_M2_2_CLOSED_OR_ADD_NONATOMIC_RECHECK_AS_A_RACE_FIX',
 'required_followup':'Independent threat-model approval, privilege and mount-writer enumeration, controlled adversarial race/crash tests, then design-reviewed remediation.',
 'independent_verdict':'PENDING_INDEPENDENT_HUMAN_REVIEW'}
out=root/'docs/security/ge04-b1a-toctou-disposition.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'TOCTOU disposition drift'
print(f'GE-04 M2.2: {len(rows)} named destructive removal sites; no atomic identity proof; human review pending')
