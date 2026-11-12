#!/usr/bin/env python3
"""Reproducible A03-01 historical-file candidate crosswalk; not a semantic proof."""
import hashlib, json, subprocess, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
DOC=ROOT/'docs/security'
def load(n):return json.loads((DOC/n).read_text())
original=load('ge04-b1a-original-63-reconciliation.json')
triage=load('ge04-b1a-broad-omission-triage.json')['entries']
pycalls=load('ge04-b1a-python-ast-call-inventory.json')['entries']
calls=load('ge04-b1a-c-authority-review-queue.json')['entries']
syntax=load('ge04-b1a-c-sensitive-disposition.json')['entries']
lexical=load('ge04-b1a-sensitive-site-context.json')['entries']
allow=load('ge04-b1a-tu-api-allowlists.json')['entries']
assert len(original['per_file'])==18
rows=[]
for r in original['per_file']:
 name=r['file']; source=ROOT/'native/ge04'/name
 assert source.is_file(),name
 baseline=subprocess.run(['git','show',f'f748ea2e3030bec9d1e3fa375374663721e7496a:native/ge04/{name}'],cwd=ROOT,capture_output=True,check=True).stdout
 assert baseline==source.read_bytes(),f'Historical source changed since approved review: {name}'
 lines=source.read_text().splitlines()
 def sites(entries):return sorted({e['line'] for e in entries if e['file']==name})
 t=sites(triage); a=sites(pycalls); c=sites(calls); s=sites(syntax); l=sites(lexical)
 al=next(e for e in allow if e['file']==name)
 assert all(1<=line<=len(lines) for line in set(t+a+c+s+l)),name
 # This is a crosswalk, not an assertion that a candidate is an omitted identity.
 rows.append({'file':name,'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),
  'reviewer_reported_omission_count':r['reviewer_reported_omitted_lines'],
  'broad_triage_lines':t,'python_ast_call_lines':a,'c_authority_queue_lines':c,
  'c_syntax_lines':s,'sensitive_lexical_lines':l,
  'allowlist_candidate_lines':sorted({e['line'] for e in al['candidate_sites']}),
  'reviewer_example_rows':[e for e in original['explicit_example_rows'] if e['file']==name],
  'candidate_union_lines':sorted(set(t+a+c+s+l)),
  'missing_identity_status':'UNKNOWN_NOT_INFERABLE_FROM_COUNTS'})
assert sum(r['reviewer_reported_omission_count'] for r in rows)==63
assert sum(len(r['broad_triage_lines']) for r in rows)==220
report={'scope':'A03-01 independently reproducible candidate crosswalk for 18 historical reviewer files',
 'source_revision':'f748ea2e3030bec9d1e3fa375374663721e7496a',
 'historical_omission_count_reported':63,'historical_files':18,
 'broad_triage_candidates':220,'reviewer_example_rows':len(original['explicit_example_rows']),
 'method':'Crosswalk original reviewer counts/examples against existing lexical, AST, C syntax, C authority, and TU allowlist artifacts; every line validated against current source.',
 'rows':rows,'result':'CANDIDATE_CROSSWALK_ONLY; HISTORICAL_63_NOT_RECONCILED',
 'unresolved':['Original 63 identities/scanner not supplied','Candidate union is not semantic completeness','Indirect calls, macros, aliases, wrappers and noncall authority remain subject to A03-02','No site-level human dispositions inferred; A03-03 remains open'],
 'security_hold':'ACTIVE'}
out=DOC/'ge04-a03-01-replacement-coverage.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'A03-01 replacement crosswalk drift'
print(f'A03-01: {len(rows)} historical files; {report["broad_triage_candidates"]} triage candidates; {report["reviewer_example_rows"]} reviewer examples; original 63 identities unresolved')
