#!/usr/bin/env python3
"""Fail-closed reviewed-source delta handoff; never grants independent approval."""
import hashlib,json,subprocess,sys
from pathlib import Path
if not __debug__:raise SystemExit('GE-04 delta checker requires assertions')
root=Path(__file__).resolve().parents[1];base=root/'native/ge04';docs=root/'docs/security';old='f748ea2e3030bec9d1e3fa375374663721e7496a'
new='7b1d727f';target='native/ge04/bootstrap_receiver.py'
def show(rev,path):return subprocess.run(['git','show',f'{rev}:{path}'],cwd=root,check=True,capture_output=True).stdout
files=sorted(p for p in base.iterdir() if p.is_file() and p.suffix in ('.c','.py'))
assert len(files)==54
changes=[]
for p in files:
 name=p.relative_to(root).as_posix();before=show(old,name);after=show(new,name)
 assert p.read_bytes()==after, f'Unreviewed working-tree drift: {name}'
 if before!=after:changes.append({'path':name,'old_sha256':hashlib.sha256(before).hexdigest(),'new_sha256':hashlib.sha256(after).hexdigest()})
assert len(changes)==1 and changes[0]['path']==target,changes
original=json.loads((docs/'ge04-a03-human-verdict-packet.json').read_text())
assert original['review_baseline']['revision']==old
for item in original['author_evidence_artifacts']:
 p=root/item['path'];assert hashlib.sha256(p.read_bytes()).hexdigest()==item['sha256']
 assert p.read_bytes()==show(old,item['path'])
assert len(original['author_evidence_artifacts'])==13
patch=subprocess.run(['git','diff','--no-ext-diff','--unified=5',old,new,'--',target],cwd=root,check=True,capture_output=True,text=True).stdout
assert 'MSG_DONTWAIT' in patch and 'MSG_CMSG_CLOEXEC' in patch
assert 'socket.MSG_CMSG_CLOEXEC | socket.MSG_DONTWAIT' in (base/'bootstrap_receiver.py').read_text()
report={'scope':'GE-04 A03 independent re-review handoff after nonblocking recvmsg fix','old_reviewed_revision':old,'new_candidate_revision':new,'source_files_verified':54,'unchanged_source_files':53,'changed_source_files':changes,'unchanged_evidence_artifacts_verified':13,'source_patch':patch,'targeted_tests':'tests/agents/test_ge04_bootstrap_receiver.py','independent_reviewer_verdict':'PENDING','new_baseline_approved':False,'old_baseline_still_valid_for_new_source':False,'site_authority_verdict':'PENDING','security_hold':'ACTIVE','limitations':['Source delta and local tests do not replace independent human review','No operational root execution, worker admission, ACK or merge authorized','Old immutable baseline checker must continue rejecting changed source until renewed review']}
out=docs/'ge04-a03-bootstrap-receiver-review-delta.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'Review delta evidence drift'
print('A03 review delta: 53 unchanged, 1 changed, 13 evidence artifacts intact; approval PENDING')
