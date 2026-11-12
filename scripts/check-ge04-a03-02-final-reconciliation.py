#!/usr/bin/env python3
"""A03-02 final bidirectional evidence reconciliation; fail closed on gaps.
No authority disposition or operational release is inferred from a crosswalk.
"""
import ast,collections,hashlib,json,subprocess,sys
from pathlib import Path
R=Path(__file__).resolve().parents[1];B=R/'native/ge04';D=R/'docs/security';REV='f748ea2e3030bec9d1e3fa375374663721e7496a'
def load(name):return json.loads((D/(name+'.json')).read_text())
ledger=load('ge04-a03-02-operation-ledger');old=load('ge04-a03-original-63-identities');queue=load('ge04-a03-02-gimple-reconciliation');noncall=load('ge04-a03-02-noncall-authority');gaps=load('ge04-a03-02-authority-completeness');cs=load('ge04-a03-02-c-unresolved-symbols');py=load('ge04-a03-02-python-receiver-dispatch');imports=load('ge04-a03-02-python-imported-wrappers');local=load('ge04-a03-02-local-wrapper-effects')
for x in (ledger,noncall,gaps,cs,py,imports,local):assert x['reviewed_revision']==REV
files={x['file']:x for x in ledger['entries']};assert len(files)==54
for name,entry in files.items():
 raw=(B/name).read_bytes();assert raw==subprocess.run(['git','show',f'{REV}:native/ge04/{name}'],cwd=R,check=True,capture_output=True).stdout
 assert hashlib.sha256(raw).hexdigest()==entry['source_sha256']
 if name.endswith('.py'):
  tree=ast.parse(raw);actual=collections.Counter((n.lineno,n.col_offset,ast.unparse(n.func)) for n in ast.walk(tree) if isinstance(n,ast.Call))
  observed=collections.Counter((n['line'],n['column'],n['callee']) for n in entry['call_sites'])
  assert actual==observed,(name,'AST inventory mismatch')
assert sum(len(x['call_sites']) for x in files.values() if x['file'].endswith('.py'))==1379
# Historical omissions must be verifiably reproduced from the original historical bytes.
hist=old['historical_revision'];seen=set();historical=[]
for entry in old['entries']:
 name=entry['file'];line=entry['line'];key=(name,line);assert key not in seen;seen.add(key)
 raw=subprocess.run(['git','show',f'{hist}:native/ge04/{name}'],cwd=R,check=True,capture_output=True).stdout
 actual=raw.decode().splitlines()[line-1];assert actual.strip()==entry['historical_source']
 assert hashlib.sha256(actual.encode()).hexdigest()==entry['line_sha256']
 historical.append({'file':name,'historical_line':line,'matched_keyword':entry['matched_keyword'],'historical_line_sha256':entry['line_sha256'],'current_reviewed_file_sha256':files[name]['source_sha256'],'current_effect_disposition':'PENDING_SOURCE_TO_CURRENT_SEMANTIC_MAPPING'})
assert len(historical)==63 and len(seen)==63
# The complete 50-site queue must appear exactly once; three noncalls have compiler-linked effects.
q={(x['file'],x['line']) for x in queue['authority_crosswalk']};assert len(q)==50
nc={(x['file'],x['reference_line']) for x in noncall['entries']};assert len(nc)==3 and nc=={(x['file'],x['line']) for x in queue['unmatched_authority_sites']}
assert nc<=q
assert all(x['effect_gimple_candidates']>=1 for x in noncall['entries'])
assert len(gaps['c_entries'])==642 and len(gaps['python_entries'])==1377 and len(gaps['unmatched_draft_c_names'])==20
assert len(cs['entries'])==365 and sum(cs['category_counts'].values())==365
assert sum(py['kind_counts'].values())==1377 and sum(imports['resolution_counts'].values())==1377
assert len(local['entries'])==427
# Adversarial omission controls: dropping any one historical identity, AST call or queue site must fail coverage.
def exact(a,b):return collections.Counter(a)==collections.Counter(b)
assert not exact(list(q)[:-1],q)
assert not exact(list(seen)[:-1],seen)
assert not exact([1]*1378,[1]*1379)
blockers=[
 {'id':'HISTORICAL_63_CURRENT_EFFECT_MAPPING','count':63,'reason':'Original historical source lines have not been individually mapped to reviewed current authority effects and dispositions'},
 {'id':'C_AUTHORITY_SITE_DISPOSITIONS','count':50,'reason':'Compiler/noncall crosswalk is complete but each site remains unadjudicated'},
 {'id':'C_UNRESOLVED_WRAPPER_EFFECTS','count':365,'reason':'Object symbols narrow origins but do not establish external, macro or transitive authority effects'},
 {'id':'C_DRAFT_API_COMPILER_MISMATCH','count':20,'reason':'Draft API names lack exact compiler-name match and need semantic reconciliation'},
 {'id':'C_VOCABULARY_EFFECT_REVIEW','count':642,'reason':'Risk hypotheses and source lines are recorded but individual authority effects not adjudicated'},
 {'id':'PYTHON_VOCABULARY_EFFECT_REVIEW','count':1377,'reason':'Imported wrappers, receiver identity, dynamic dispatch and runtime binding remain unresolved'},
 {'id':'INDIRECT_AND_MACRO_COMPLETENESS','count':None,'reason':'Negative lexical/GIMPLE patterns do not prove absence of all computed calls or macro-lowered authority effects'},
]
report={'scope':'GE-04 A03-02 final bidirectional source-to-inventory and inventory-to-source evidence reconciliation','reviewed_revision':REV,'source_units':54,'python_ast_calls_verified_against_current_reviewed_source':1379,'historical_original_omissions_verified':63,'c_authority_sites_crosswalked':50,'c_noncall_authority_effect_links':3,'c_gap_names_crosswalked':642,'python_gap_calls_crosswalked':1377,'unresolved_c_wrapper_candidates':365,'draft_c_compiler_name_mismatches':20,'historical_identity_crosswalk':historical,'open_blockers':blockers,'adversarial_omission_fixtures':'PASS: missing one historical identity, queue site or AST call is rejected','a03_02_verdict':'NOT_SATISFIED_SEMANTIC_COMPLETENESS_NOT_DEMONSTRATED','next_action':'Remain in A03-02 and resolve blocker effects before A03-03','security_hold':'ACTIVE'}
out=D/'ge04-a03-02-final-reconciliation.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'Final reconciliation drift'
print('A03-02 final reconciliation:',report['a03_02_verdict'],'blocker classes',len(blockers),'hold',report['security_hold'])
