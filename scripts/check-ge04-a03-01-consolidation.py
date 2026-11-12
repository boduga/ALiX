#!/usr/bin/env python3
"""A03-01 evidence consolidation, explicitly fail-open for no security verdicts."""
import hashlib,json,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];D=ROOT/'docs/security'
def read(n):return json.loads((D/n).read_text())
h=read('ge04-a03-01-historical-omission-recovery.json')
x=read('ge04-a03-01-replacement-coverage.json')
p=read('ge04-a03-01-python-dispatch.json')
c=read('ge04-a03-01-c-dispatch.json')
identities=read('ge04-a03-original-63-identities.json')
assert identities['omitted_line_identities']==63 and identities['files']==18
review='f748ea2e3030bec9d1e3fa375374663721e7496a'
assert h['reviewer_reported_total']==x['historical_omission_count_reported']==63
assert len(h['per_file_counts'])==x['historical_files']==18
assert x['reviewer_example_rows']==len(h['examples'])==18
assert p['files']+c['historical_c_files']==18
byname={r['file']:r for r in x['rows']}
assert set(byname)=={r['file'] for r in p['rows']+c['rows']}
for r in p['rows']+c['rows']:
 name=r['file'];digest=hashlib.sha256((ROOT/'native/ge04'/name).read_bytes()).hexdigest()
 assert digest==r['sha256']==byname[name]['sha256'],name
 baseline=subprocess.run(['git','show',f'{review}:native/ge04/{name}'],cwd=ROOT,capture_output=True,check=True).stdout
 assert hashlib.sha256(baseline).hexdigest()==digest,name
assert c['known_authority_queue_sites_covered']==sum(len(r['existing_authority_queue']) for r in c['rows'])
assert p['calls']==sum(len(r['calls']) for r in p['rows'])
report={'scope':'GE-04 A03-01 consolidated evidence and explicit remaining gap','reviewed_revision':review,'historical_reported_omissions':63,'historical_files':18,'reviewer_explicit_examples':18,'broad_triage_candidates':x['broad_triage_candidates'],'python_files':p['files'],'python_ast_calls':p['calls'],'python_alias_assignment_candidates':p['assignment_alias_candidates'],'python_dynamic_dispatch_candidates':p['dynamic_dispatch_candidates'],'c_files':c['historical_c_files'],'c_lexical_candidate_lines':c['lexical_candidate_sites'],'c_existing_authority_queue_sites_covered':c['known_authority_queue_sites_covered'],'evidence_files':['ge04-a03-original-63-identities.json','ge04-a03-01-historical-omission-recovery.json','ge04-a03-01-replacement-coverage.json','ge04-a03-01-python-dispatch.json','ge04-a03-01-c-dispatch.json'],'source_hashes_verified':18,'historical_omission_identities_reconstructed':63,'historical_identity_evidence':'ge04-a03-original-63-identities.json','assessment':'A03-01 HISTORICAL IDENTITY GAP RESOLVED: exact original scanner reproduced all 63 omitted historical lines; semantic security review remains A03-02 and site adjudication A03-03','blocking_gaps':['Original 63 historical identities recovered; lexical scanner does not establish authority semantics','C candidate scan is intentionally overinclusive and does not resolve macro expansion, indirect call targets or multiline constructs','Python candidate scan does not resolve runtime aliasing, monkeypatching or dynamic dispatch','A03-02 semantic completeness and A03-03 site-level dispositions remain necessary','No evidence here establishes privileged runtime safety or clears the operational hold'],'acceptance_rule':'Historical identity reconciliation SATISFIED by exact 63/63 original scanner reproduction; semantic and site-level security acceptance are separate A03-02 and A03-03 gates','security_hold':'ACTIVE'}
out=D/'ge04-a03-01-consolidated-assessment.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'A03-01 consolidated evidence drift'
print('A03-01: 18/18 baseline sources verified; 63/63 original identities recovered; semantic A03-02 and site A03-03 remain')
