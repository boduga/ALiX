#!/usr/bin/env python3
"""Fail-closed reviewed-source delta handoff; never grants independent approval."""
import hashlib,json,subprocess,sys
from pathlib import Path
if not __debug__:raise SystemExit('GE-04 delta checker requires assertions')
root=Path(__file__).resolve().parents[1];base=root/'native/ge04';docs=root/'docs/security';old='f748ea2e3030bec9d1e3fa375374663721e7496a'
new='7b1d727f';target='native/ge04/bootstrap_receiver.py'
# Derived evidence that embeds reviewed-source line numbers must be regenerated
# after any edit above those lines. Only these paths may differ from the reviewed
# baseline, and only in line-number leaves; every other evidence byte stays pinned.
regenerated_reasons={
 'docs/security/ge04-b1a-tu-api-allowlists.json':
  'Derived per-TU allowlist embeds reviewed-source line numbers; regenerated from the fixed candidate source.',
 'docs/security/ge04-b1a-descriptor-transfer-review.json':
  'Source-anchor line lists embed reviewed-source line numbers; regenerated from the fixed candidate source.',
}
regenerated_paths=sorted(regenerated_reasons)
def show(rev,path):return subprocess.run(['git','show',f'{rev}:{path}'],cwd=root,check=True,capture_output=True).stdout
def is_line_leaf(ptr):
 # Scalars keyed `line`, and entries of a `lines` array, carry only a location.
 return ptr.endswith('/line') or (ptr.endswith(']') and ptr.rsplit('[',1)[0].endswith('/lines'))
def leaves(a,b,ptr=''):
 out=[]
 if type(a)!=type(b):return [(ptr,a,b)]
 if isinstance(a,dict):
  for k in sorted(set(a)|set(b)):
   if k not in a or k not in b:out.append((ptr+'/'+k,a.get(k),b.get(k)))
   else:out.extend(leaves(a[k],b[k],ptr+'/'+k))
 elif isinstance(a,list):
  if len(a)!=len(b):return [(ptr+'/length',len(a),len(b))]
  for i,(x,y) in enumerate(zip(a,b)):out.extend(leaves(x,y,f'{ptr}[{i}]'))
 elif a!=b:out.append((ptr,a,b))
 return out
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
# The reviewed packet stays immutable: its hashes record the reviewed baseline.
assert len(original['author_evidence_artifacts'])==13
pinned={item['path']:item['sha256'] for item in original['author_evidence_artifacts']}
regenerated=[]
for path in regenerated_paths:
 assert path in pinned,f'Regenerated artifact is not packet evidence: {path}'
 before=show(old,path);p=root/path;after=p.read_bytes()
 assert hashlib.sha256(before).hexdigest()==pinned[path],f'Old artifact is not the reviewed baseline: {path}'
 assert after!=before,f'{path} is declared regenerated but is identical to the baseline'
 moved=leaves(json.loads(before),json.loads(after))
 # Regeneration may relocate line numbers and nothing else.
 assert moved and all(is_line_leaf(ptr) for ptr,_,_ in moved),f'Non-line evidence drift: {path}: {moved[:4]}'
 regenerated.append({'path':path,'old_sha256':pinned[path],'new_sha256':hashlib.sha256(after).hexdigest(),'reason':regenerated_reasons[path],'relocated_line_only':[{'pointer':ptr,'old':was,'new':now} for ptr,was,now in moved]})
for path,digest in pinned.items():
 if path in regenerated_paths:continue
 p=root/path
 assert hashlib.sha256(p.read_bytes()).hexdigest()==digest,f'Unreviewed evidence drift: {path}'
 assert p.read_bytes()==show(old,path),f'Unreviewed evidence drift: {path}'
patch=subprocess.run(['git','diff','--no-ext-diff','--unified=5',old,new,'--',target],cwd=root,check=True,capture_output=True,text=True).stdout
assert 'MSG_DONTWAIT' in patch and 'MSG_CMSG_CLOEXEC' in patch
assert 'socket.MSG_CMSG_CLOEXEC | socket.MSG_DONTWAIT' in (base/'bootstrap_receiver.py').read_text()
report={'scope':'GE-04 A03 independent re-review handoff after nonblocking recvmsg fix','old_reviewed_revision':old,'new_candidate_revision':new,'source_files_verified':54,'unchanged_source_files':53,'changed_source_files':changes,'unchanged_evidence_artifacts_verified':len(pinned)-len(regenerated),'regenerated_evidence_artifacts':regenerated,'source_patch':patch,'targeted_tests':'tests/agents/test_ge04_bootstrap_receiver.py','independent_reviewer_verdict':'PENDING','new_baseline_approved':False,'old_baseline_still_valid_for_new_source':False,'site_authority_verdict':'PENDING','security_hold':'ACTIVE','limitations':['Source delta and local tests do not replace independent human review','No operational root execution, worker admission, ACK or merge authorized','Renumbered line references reflect the MSG_DONTWAIT edit only and are not a review of either site','Old immutable baseline checker must continue rejecting changed source until renewed review']}
out=docs/'ge04-a03-bootstrap-receiver-review-delta.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'Review delta evidence drift'
print(f'A03 review delta: 53 unchanged, 1 changed, {len(pinned)-len(regenerated)} evidence artifacts intact, {len(regenerated)} rebaselined line-only; approval PENDING')
