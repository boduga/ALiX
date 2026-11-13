#!/usr/bin/env python3
"""Bidirectional, fail-closed candidate-to-allowlist gap accounting.

An author draft allowlist is not a complete list of sensitive effects.
Unlisted compiler calls remain explicit review candidates, not benign.
"""
import json,sys
from collections import Counter
from pathlib import Path
D=Path(__file__).resolve().parents[1]/'docs/security'
def read(name):return json.loads((D/name).read_text())
g=read('ge04-a03-02-gcc-callsite-provenance.json')
a=read('ge04-b1a-tu-api-allowlists.json')
p=read('ge04-a03-02-python-aliases.json')
q=read('ge04-b1a-c-authority-review-queue.json')
allow={x['file']:x for x in a['entries']};assert len(allow)==54
python={x['file']:x for x in p['entries']};assert len(python)==24
queue={}
for site in q['entries']:queue.setdefault(site['file'],set()).update(site['apis'])
rows=[];unlisted=Counter();missing=Counter()
for unit in g['entries']:
 name=unit['file'];draft=set(allow[name]['candidate_api_allowlist'])
 actual={s['target_token'] for s in unit['gimple_call_candidates'] if not s['gimple_statement'].lstrip().startswith(('//','/*','#'))}
 extra=sorted(actual-draft);absent=sorted(draft-actual)
 unlisted.update(extra);missing.update(absent)
 rows.append({'file':name,'draft_allowlist':sorted(draft),'compiler_call_names':sorted(actual),'compiler_names_not_in_draft':extra,'draft_names_not_in_compiler_calls':absent,'queue_authority_apis':sorted(queue.get(name,set())),'status':'UNLISTED_CALLS_RETAINED_FOR_AUTHORITY_TRIAGE_NOT_CLEARED'})
pyrows=[]
for name,unit in sorted(python.items()):
 draft=set(allow[name]['candidate_api_allowlist'])
 calls=unit['calls'];expressions={c['expression'] for c in calls}
 resolved={c['resolved_static_target'] for c in calls if c['resolved_static_target']}
 pyrows.append({'file':name,'draft_allowlist':sorted(draft),'call_expressions_not_in_draft':sorted(expressions-draft),'resolved_alias_targets_not_in_draft':sorted(resolved-draft),'draft_names_not_exactly_matched_by_call_expression':sorted(draft-expressions),'status':'CANDIDATE_VOCABULARY_DIFFERENCE_NOT_API_DISPOSITION'})
assert len(rows)==30 and len(pyrows)==24
report={'scope':'A03-02 bidirectional compiler/AST versus draft API vocabulary gap','reviewed_revision':g['reviewed_revision'],'c_files':len(rows),'python_files':len(pyrows),'c_unique_unlisted_call_names':len(unlisted),'c_total_per_file_unlisted_names':sum(len(x['compiler_names_not_in_draft']) for x in rows),'c_draft_names_without_exact_compiler_match':sum(len(x['draft_names_not_in_compiler_calls']) for x in rows),'python_total_per_file_call_expressions_not_in_draft':sum(len(x['call_expressions_not_in_draft']) for x in pyrows),'c_rows':rows,'python_rows':pyrows,'status':'UNRESOLVED_API_VOCABULARY_GAP; A03-02_OPEN','limitations':['Exact spelling mismatch can arise from macros, aliases and compiler lowering','Unlisted functions can be authority-bearing through wrappers or transitive calls','Draft allowlists are not independent review or exhaustive sensitive API catalogs','Every unlisted name remains review-eligible until semantically classified','Cross-TU, dynamic dispatch, and negative paths require independent evidence'],'security_hold':'ACTIVE'}
out=D/'ge04-a03-02-api-vocabulary-gap.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'A03-02 vocabulary drift'
print('A03-02 API vocabulary:',report['c_unique_unlisted_call_names'],'distinct unlisted C call names;',report['c_total_per_file_unlisted_names'],'per-file C gaps;',report['python_total_per_file_call_expressions_not_in_draft'],'per-file Python expression gaps; all OPEN')
