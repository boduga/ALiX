#!/usr/bin/env python3
"""M2.12 evidence reconciliation for independent human review; NEVER grants acceptance."""
import hashlib,json,subprocess,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1];docs=root/'docs/security';base=root/'native/ge04'
source_files=sorted(p for p in base.iterdir() if p.is_file() and p.suffix in ('.c','.py'))
assert len(source_files)==54
names=['ge04-b1a-original-63-reconciliation.json','ge04-b1a-bidirectional-semantic-inventory.json','ge04-b1a-tu-api-allowlists.json','ge04-b1a-c-authority-review-queue.json','ge04-b1a-destructive-site-review.json','ge04-b1a-journal-recovery-review.json','ge04-b1a-toctou-disposition.json','ge04-b1a-writer-exclusion-review.json','ge04-b1a-privilege-transition-review.json','ge04-b1a-process-lifecycle-review.json','ge04-b1a-descriptor-transfer-review.json','ge04-b1a-custody-locking-review.json','ge04-b1a-systemd-bus-review.json']
artifacts=[]
for name in names:
 p=docs/name;obj=json.loads(p.read_text());artifacts.append({'path':str(p.relative_to(root)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'scope':obj.get('scope',obj.get('method','AUTHOR_EVIDENCE'))})
queue=json.loads((docs/'ge04-b1a-c-authority-review-queue.json').read_text())['entries']
assert len(queue)==50 and all(e['reviewer_verdict']=='PENDING_INDEPENDENT_HUMAN_REVIEW' for e in queue)
allow=json.loads((docs/'ge04-b1a-tu-api-allowlists.json').read_text())
assert allow['files']==54 and all(e['independent_verdict']=='PENDING_INDEPENDENT_HUMAN_REVIEW' for e in allow['entries'])
original=json.loads((docs/'ge04-b1a-original-63-reconciliation.json').read_text())
assert original['reviewer_reported_omissions']==63 and original['reviewer_reported_files']==18
assert all(e['exact_omitted_line_identities']=='NOT_PUBLISHED_BY_REVIEWER' for e in original['per_file'])
writer=json.loads((docs/'ge04-b1a-writer-exclusion-review.json').read_text())['entries']
assert all(e['writer_exclusion']=='NOT_PROVEN' for e in writer)
rev='d6e22669712e90ace6e4439d005c1856901964f3'  # Original authoring parent; stable across review-document commits
status=subprocess.run(['git','status','--porcelain','--untracked-files=all'],cwd=root,text=True,capture_output=True,check=True).stdout
# Pin the human-reviewed source and evidence bytes to the actual reviewed Git tree.
review_rev='f748ea2e3030bec9d1e3fa375374663721e7496a'
def reviewed_bytes(path):
 return subprocess.run(['git','show',f'{review_rev}:{path.relative_to(root).as_posix()}'],cwd=root,capture_output=True,check=True).stdout
baseline_paths=[*source_files,*(root/a['path'] for a in artifacts)]
baseline_mismatches=[str(p.relative_to(root)) for p in baseline_paths if hashlib.sha256(reviewed_bytes(p)).digest()!=hashlib.sha256(p.read_bytes()).digest()]
assert not baseline_mismatches, f'Reviewed source/evidence baseline changed: {baseline_mismatches}'
report={'scope':'GE-04 A.03 M2.12 INDEPENDENT HUMAN VERDICT HANDOFF',
 'decision':'HUMAN_REVIEW_APPROVED; OPERATIONAL_HOLD_ACTIVE',
 'decision_authority':'USER_HUMAN_REVIEWER',
 'authoring_parent_revision':rev,'review_revision':'f748ea2e3030bec9d1e3fa375374663721e7496a','working_tree_dirty':bool(status.strip()),
 'immutable_review_baseline_established':True,
 'review_baseline':{'revision':review_rev,'source_files_verified':len(source_files),'evidence_artifacts_verified':len(artifacts),'source_and_evidence_match_reviewed_git_tree':True,'working_tree_dirty_scope':'GLOBAL_REPOSITORY_ONLY_NOT_REVIEWED_SOURCE_OR_EVIDENCE','future_changes_require_new_review':True},
 'user_reported_verdict':{'decision':'APPROVED','reported_on':'2026-11-11','channel':'ChatGPT conversation','reviewed_revision_claim':'f748ea2e3030bec9d1e3fa375374663721e7496a','attestation_status':'DIRECT_HUMAN_REVIEWER_APPROVAL_IN_CONVERSATION','reviewer_identity':'PROJECT_OWNER_USER','per_site_review':'NOT_PROVIDED','blocker_dispositions':'NOT_PROVIDED','effect':'HUMAN_REVIEW_APPROVED_SEPARATE_HOLD_RELEASE_REQUIRED'},
 'review_record':{'reviewer_role':'PROJECT_OWNER_HUMAN','recorded_by':'CHATGPT_ASSISTANT_AS_SCRIBE','decision':'APPROVED','decision_date':'2026-11-11','reviewed_revision':review_rev,'review_scope':'GE-04 A.03 M2.12 evidence and reviewed source baseline','decision_provenance':'Direct project-owner conversation approval; no separate signed per-site report supplied','individual_site_dispositions':'NOT_SEPARATELY_DOCUMENTED','exceptions':'NOT_SEPARATELY_DOCUMENTED','open_evidence_items':[f'A03-{n:02d}' for n in (1,2,3,4,5,6)],'baseline_item':'A03-07 VERIFIED','record_item':'A03-08 DOCUMENTED; missing site-level dispositions remain visible','operational_authority':'NONE; SECURITY HOLD ACTIVE'},
 'source_hashes':[{'path':str(p.relative_to(root)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in source_files],
 'author_evidence_artifacts':artifacts,
 'review_queue':{'c_authority_sites':len(queue),'pending_c_authority_sites':sum(e['reviewer_verdict']=='PENDING_INDEPENDENT_HUMAN_REVIEW' for e in queue),'per_tu_draft_allowlists':allow['files'],'reviewer_reported_historical_omissions':original['reviewer_reported_omissions'],'historical_omission_identities_verified':0,'writer_exclusion_proven':False},
 'blocking_human_review_decisions':[
 {'id':'A03-01','issue':'Original 63 omitted historical line identities not supplied or independently replaced','required':'Reviewer-approved identity-level reconciliation or independently accepted equivalent semantic audit'},
 {'id':'A03-02','issue':'Semantic authority coverage incomplete: unknown APIs, indirect calls, aliases, wrappers, macros and noncall authority references','required':'Reviewed bidirectional operation inventory and per-TU allowlists for all current sources'},
 {'id':'A03-03','issue':'50 C authority queue sites and other candidate sites lack individual independent human verdicts','required':'Site-level signed review of authorization, identity, TOCTOU, failure, cleanup and replay'},
 {'id':'A03-04','issue':'Writer exclusion, inode-conditional name deletion and crash-recovery durability not proven','required':'Independent design resolution and authorized negative/fault-injection evidence'},
 {'id':'A03-05','issue':'Privileged transition, process, descriptor transfer and D-Bus adversarial validation not completed','required':'Authorized qualification and reviewer adjudication; no protected execution under current hold'},
 {'id':'A03-06','issue':'Candidate-only CI drift gate cannot detect unknown authority surfaces and has not run in GitHub Actions','required':'Human-approved reviewed-API regression gate at immutable final source revision and CI evidence'},
 {'id':'A03-07','issue':'Reviewed source and evidence are pinned to an immutable Git revision; future changes require re-review','required':'SATISFIED for reviewed source/evidence at f748ea2e; re-verify and re-review any subsequent changes'},
 {'id':'A03-08','issue':'Project owner human approval and review scope recorded; individual dispositions and exceptions remain undocumented','required':'REVIEW RECORD SATISFIED; outstanding site-level dispositions and exceptions remain explicit under A03-03 and other open evidence items'}],
 'human_verdict_template':{'reviewer_identity':'PROJECT_OWNER_USER','review_date':'2026-11-11','reviewed_revision':'f748ea2e3030bec9d1e3fa375374663721e7496a','reviewed_source_hash_manifest':'source_hashes','per_site_verdicts':'NOT_SEPARATELY_DOCUMENTED','exceptions_and_owners':'NOT_SEPARATELY_DOCUMENTED','decision':'APPROVED'},
 'prohibited_inferences':['Author-side checks are not human acceptance','AI reviewer findings are not independent human acceptance','A.03 evidence does not authorize root execution, worker admission, ACK, systemd dispatch or PR merge'],
 'security_hold':'ACTIVE'}
out=docs/'ge04-a03-human-verdict-packet.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'M2.12 evidence packet drift'
print(f'M2.12: {len(source_files)} source hashes, {len(artifacts)} artifacts; human reviewer APPROVED; operational HOLD active')
