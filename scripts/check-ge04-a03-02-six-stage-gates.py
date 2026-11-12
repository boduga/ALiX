#!/usr/bin/env python3
"""Ordered A03-02 work-package gate evaluation; refuses unproven semantic closure."""
import json,sys,collections
from pathlib import Path
D=Path(__file__).resolve().parents[1]/'docs/security'
def read(n):return json.loads((D/(n+'.json')).read_text())
h=read('ge04-a03-02-historical-current-map');q=read('ge04-a03-02-gimple-reconciliation');non=read('ge04-a03-02-noncall-authority');c=read('ge04-a03-02-authority-completeness');wr=read('ge04-a03-02-c-unresolved-symbols');py=read('ge04-a03-02-python-receiver-dispatch');im=read('ge04-a03-02-python-imported-wrappers');fin=read('ge04-a03-02-final-reconciliation')
assert h['total']==63 and len(h['entries'])==63
assert q['c_authority_sites']==50 and len(q['authority_crosswalk'])==50
assert len(non['entries'])==3 and len(wr['entries'])==365 and len(c['c_entries'])==642 and len(c['python_entries'])==1377
assert len(py['entries'])==len(im['entries'])==24
nc={(x['file'],x['reference_line']):x for x in non['entries']}
qrows=[]
for x in q['authority_crosswalk']:
 key=(x['file'],x['line']);effect=nc.get(key)
 qrows.append({'file':x['file'],'line':x['line'],'apis':x['apis'],'compiler_call_targets':[y['target'] for y in x['gimple_call_candidates']],'noncall_effect_target':effect['effect_target'] if effect else None,'noncall_effect_line':effect['effect_line'] if effect else None,'semantic_effect_verdict':'PENDING','authority_guard_verdict':'PENDING'})
assert len(qrows)==50 and sum(bool(x['compiler_call_targets']) for x in qrows)==47
cclasses=collections.Counter(x['category'] for x in wr['entries']);assert sum(cclasses.values())==365
python_dynamic=[{'file':f['file'],'line':x['line'],'expression':x['expression'],'selector_candidates':x['dynamic_selector_literal_candidates']} for f in py['entries'] for x in f['entries'] if x['kind']=='DYNAMIC_DISPATCH']
assert len(python_dynamic)==1
stages=[
 {'stage':1,'name':'Historical-to-current effect mapping','source_lines_located':63,'unique_exact_source_lines':sum(x['source_match_kind']=='UNIQUE_EXACT_LINE' for x in h['entries']),'semantic_effects_approved':0,'gate':'BLOCKED','reason':'Source matches do not establish equivalent authority effects'},
 {'stage':2,'name':'C authority-site semantic review','compiler_or_noncall_effect_crosswalk':50,'security_dispositions_approved':0,'gate':'BLOCKED','reason':'Compiler evidence does not prove authorization boundaries or effects'},
 {'stage':3,'name':'C wrapper and API closure','wrapper_origin_candidates':365,'c_api_gap_names':642,'draft_compiler_mismatches':20,'semantic_effects_approved':0,'gate':'BLOCKED','reason':'External, macro, transitive and indirect effects remain unverified'},
 {'stage':4,'name':'Python transitive-effect closure','python_gap_calls':1377,'dynamic_invocations':len(python_dynamic),'semantic_effects_approved':0,'gate':'BLOCKED','reason':'Runtime binding, receiver and transitive effects remain unresolved'},
 {'stage':5,'name':'Indirect-call and macro completeness','compiler_candidate_sites':q['gimple_candidate_count'],'semantic_completeness_proven':False,'gate':'BLOCKED','reason':'Negative indirect-call searches and compiler lowering are not exhaustive semantic proof'},
 {'stage':6,'name':'Final independent reconciliation','historical_omissions':63,'c_authority_sites':50,'python_ast_calls':1379,'semantic_completeness_proven':False,'gate':'BLOCKED','reason':'Prior stage gates remain blocked; cannot certify independent closure'},
]
assert all(x['gate']=='BLOCKED' for x in stages)
report={'scope':'GE-04 A03-02 ordered six-work-package gate assessment','reviewed_revision':fin['reviewed_revision'],'historical_to_current_source_matches':h['match_counts'],'c_authority_site_effect_candidates':qrows,'c_unresolved_object_symbol_categories':dict(cclasses),'python_dynamic_candidates':python_dynamic,'stages':stages,'overall':'NOT_SATISFIED_DO_NOT_ADVANCE_TO_A03_03','review_note':'All six packages assessed in order. None can be declared semantically complete from available evidence; source matches and compiler symbols are not approvals.','security_hold':'ACTIVE'}
out=D/'ge04-a03-02-six-stage-gates.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'Six-stage gate drift'
print('A03-02 ordered stage gates:',[(x['stage'],x['gate']) for x in stages],report['overall'])
