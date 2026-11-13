#!/usr/bin/env python3
"""Reconcile source-located GCC candidates with C authority review sites.

Never treats missing candidate matches or unresolved computed calls as safe.
"""
import json,re,sys
from collections import Counter
from pathlib import Path
D=Path(__file__).resolve().parents[1]/'docs/security'
def load(n):return json.loads((D/n).read_text())
g=load('ge04-a03-02-gcc-callsite-provenance.json');q=load('ge04-b1a-c-authority-review-queue.json')['entries']
byfile={e['file']:e for e in g['entries']};assert len(byfile)==30
# GIMPLE diagnostic annotations contain words such as "return (...)" that
# are not calls. Explicitly distinguish them from executable statements.
def classify(site):
 s=site['gimple_statement'].strip();target=site['target_token']
 if s.startswith(('//','/*','#')):return 'DIAGNOSTIC_ANNOTATION_NOT_CALL'
 if target in ('if','switch','return','sizeof','typeof'):return 'CONTROL_OR_NONCALL'
 if re.search(r'\b(?:D\.\d+|_[0-9]+)\s*\(',s):return 'COMPUTED_CALLEE_REQUIRES_TARGET_RESOLUTION'
 if re.search(r'\(\s*\*\s*\w+\s*\)\s*\(',s):return 'POINTER_CALLEE_REQUIRES_TARGET_RESOLUTION'
 return 'LOWERED_NAMED_CALL_CANDIDATE'
# Adversarial classifier checks: diagnostic text is not executable, but
# ordinary direct calls and computed targets must remain visible.
assert classify({'gimple_statement':'// predicted unlikely by early return (on trees) predictor.','target_token':'return'})=='DIAGNOSTIC_ANNOTATION_NOT_CALL'
assert classify({'gimple_statement':'unlinkat (fd, name, 0);','target_token':'unlinkat'})=='LOWERED_NAMED_CALL_CANDIDATE'
assert classify({'gimple_statement':'_8 (arg);','target_token':'_8'})=='COMPUTED_CALLEE_REQUIRES_TARGET_RESOLUTION'
rows=[];missing=[];counts=Counter();byloc={}
for name,unit in byfile.items():
 for site in unit['gimple_call_candidates']:
  kind=classify(site);counts[kind]+=1
  if kind in ('DIAGNOSTIC_ANNOTATION_NOT_CALL','CONTROL_OR_NONCALL'):continue
  for loc in site['locations']:
   if loc['file']==name:byloc.setdefault((name,loc['line']),[]).append({'target':site['target_token'],'kind':kind})
for e in q:
 key=(e['file'],e['line']);matches=byloc.get(key,[])
 if not matches:missing.append({'file':e['file'],'line':e['line'],'apis':e['apis'],'reason':'NO_GIMPLE_CALL_AT_EXACT_SOURCE_LINE; MAY_BE_FLAG_OR_MULTILINE_CALL'})
 rows.append({'file':e['file'],'line':e['line'],'apis':e['apis'],'gimple_call_candidates':matches,'disposition':'UNADJUDICATED_AUTHORITY_SITE'})
assert len(rows)==50
report={'scope':'A03-02 GCC source-callsite to 50 C authority sites reconciliation','gimple_candidate_count':g['call_candidates'],'candidate_classification_counts':dict(counts),'c_authority_sites':len(rows),'authority_sites_with_same_line_gimple_call':len(rows)-len(missing),'authority_sites_without_same_line_gimple_call':len(missing),'unmatched_authority_sites':missing,'authority_crosswalk':rows,'result':'CROSSWALK_ONLY_NOT_SEMANTIC_CLOSURE','limitations':['Exact-line matching does not account for macro-origin provenance or multiline calls','Compiler-generated calls can share source locations with other operations','Named calls can dispatch through wrappers and have unknown effects','All 50 authority sites still require individual review','No unlisted authority site is deemed absent or safe'],'security_hold':'ACTIVE'}
out=D/'ge04-a03-02-gimple-reconciliation.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'A03-02 reconciliation drift'
print('A03-02:',len(rows),'C sites reconciled;',len(missing),'without same-line GIMPLE call;',dict(counts))
