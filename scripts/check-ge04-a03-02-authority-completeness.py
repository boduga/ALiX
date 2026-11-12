#!/usr/bin/env python3
"""A03-02 risk-first vocabulary reconciliation, never an authority clearance.
Reconciles every draft gap with compiler/AST provenance and previous triage.
"""
import collections,hashlib,json,subprocess,sys
from pathlib import Path
R=Path(__file__).resolve().parents[1];B=R/'native/ge04';D=R/'docs/security';REV='f748ea2e3030bec9d1e3fa375374663721e7496a'
def load(name):return json.loads((D/('ge04-a03-02-'+name+'.json')).read_text())
gaps=load('api-vocabulary-gap');c=load('authority-priority');p=load('python-effect-triage');cs=load('c-unresolved-symbols');pi=load('python-imported-wrappers');pr=load('python-receiver-dispatch')
for obj in (gaps,c,p,cs,pi,pr):assert obj['reviewed_revision']==REV
source={}
for path in sorted(B.iterdir()):
 if path.suffix not in ('.c','.py'):continue
 raw=path.read_bytes();assert raw==subprocess.run(['git','show',f'{REV}:native/ge04/{path.name}'],cwd=R,capture_output=True,check=True).stdout
 source[path.name]=hashlib.sha256(raw).hexdigest()
assert len(source)==54
cindex={(x['file'],x['symbol']):x for x in c['entries']};csindex={(x['file'],x['symbol']):x for x in cs['entries']}
pindex={(x['file'],s['line'],s['column'],s['expression']):s for x in p['entries'] for s in x['entries']}
piindex={(x['file'],s['line'],s['column'],s['expression']):s for x in pi['entries'] for s in x['entries']}
prindex={(x['file'],s['line'],s['column'],s['expression']):s for x in pr['entries'] for s in x['entries']}
crows=[];prows=[];c_counts=collections.Counter();p_counts=collections.Counter()
for f in gaps['c_rows']:
 for name in f['compiler_names_not_in_draft']:
  key=(f['file'],name);item=cindex[key];symbol=csindex.get(key)
  categories=item['triage_categories'];assert categories
  c_counts.update(categories)
  crows.append({'file':f['file'],'source_sha256':source[f['file']],'symbol':name,'source_lines':item['source_lines'],'risk_hypotheses':categories,'object_symbol_evidence':symbol['category'] if symbol else 'NOT_IN_UNRESOLVED_365_SUBSET','authority_effect_status':'PENDING_SEMANTIC_REVIEW','security_verdict':'PENDING'})
for f in gaps['python_rows']:
 entries=[(key,item) for key,item in pindex.items() if key[0]==f['file'] and key[3] in f['call_expressions_not_in_draft']]
 assert {key[3] for key,item in entries}==set(f['call_expressions_not_in_draft'])
 for key,item in entries:
  alias=piindex[key];receiver=prindex[key];p_counts.update(item['triage_categories'])
  prows.append({'file':f['file'],'source_sha256':source[f['file']],'line':key[1],'column':key[2],'expression':key[3],'risk_hypotheses':item['triage_categories'],'import_candidate':alias['resolution'],'receiver_candidate':receiver['kind'],'authority_effect_status':'PENDING_SEMANTIC_REVIEW','security_verdict':'PENDING'})
assert len(crows)==642 and len(prows)==1377 and len({(x['file'],x['expression']) for x in prows})==607
unmatched=[{'file':f['file'],'draft_name':name,'status':'EXACT_COMPILER_NAME_UNMATCHED_NEEDS_MACRO_OR_API_RECONCILIATION'} for f in gaps['c_rows'] for name in f['draft_names_not_in_compiler_calls']]
assert len(unmatched)==20
report={'scope':'A03-02 full draft API vocabulary gap-to-source and risk hypothesis reconciliation','reviewed_revision':REV,'reviewed_source_files':54,'c_per_file_gap_names':len(crows),'python_gap_callsite_occurrences':len(prows),'python_distinct_per_file_gap_expressions':607,'draft_c_names_without_exact_compiler_match':len(unmatched),'c_risk_hypothesis_counts':dict(sorted(c_counts.items())),'python_risk_hypothesis_counts':dict(sorted(p_counts.items())),'c_entries':crows,'python_entries':prows,'unmatched_draft_c_names':unmatched,'status':'COMPLETE_GAP_CROSSWALK_NOT_COMPLETE_AUTHORITY_SEMANTICS','limitations':['Vocabulary completeness is not semantic completeness or security approval','Categories are regex-derived hypotheses and may overlap or miss authority effects','All 642 C gap names, 1377 Python occurrences, and 20 unmatched draft C names remain pending effect review','Compiler lowering, macros, runtime receiver identity, external libraries and transitive effects are not fully resolved','Original 63 and authority sites require final bidirectional reconciliation in Task 5'],'security_hold':'ACTIVE'}
out=D/'ge04-a03-02-authority-completeness.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'Authority completeness crosswalk drift'
print('A03-02 gap crosswalk:',len(crows),'C names;',len(prows),'Python sites;',len(unmatched),'unmatched draft C names; ALL PENDING')
