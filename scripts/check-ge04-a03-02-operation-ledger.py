#!/usr/bin/env python3
"""A03-02: complete-source candidate ledger, not a complete semantic call graph.

All 54 reviewed C/Python files must be represented. Fail on unreviewed source
changes, AST drift, GCC candidate drift, or missing historical omission sites.
"""
import ast,hashlib,json,re,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];BASE=ROOT/'native/ge04';DOC=ROOT/'docs/security'
REV='f748ea2e3030bec9d1e3fa375374663721e7496a'
def read(name):return json.loads((DOC/name).read_text())
original=read('ge04-a03-original-63-identities.json')
compiled={r['file']:r['lowered_call_name_candidates'] for r in read('ge04-b1a-c-compiler-call-inventory.json')['entries']}
known_calls=read('ge04-b1a-python-ast-call-inventory.json')['entries']
queue=read('ge04-b1a-c-authority-review-queue.json')['entries']
allow={r['file']:r for r in read('ge04-b1a-tu-api-allowlists.json')['entries']}
files=sorted(p for p in BASE.iterdir() if p.suffix in ('.c','.py') and p.is_file())
assert len(files)==54 and len(allow)==54 and len(compiled)==30
rows=[];pycount=0
for p in files:
 raw=p.read_bytes();name=p.name
 historical=subprocess.run(['git','show',f'{REV}:native/ge04/{name}'],cwd=ROOT,capture_output=True,check=True).stdout
 assert historical==raw,f'A03-02 baseline source changed: {name}'
 row={'file':name,'kind':p.suffix[1:],'source_sha256':hashlib.sha256(raw).hexdigest(),
      'review_status':'CANDIDATE_INVENTORY_NOT_SITE_SECURITY_VERDICT',
      'existing_allowlist_status':allow[name]['allowlist_status']}
 if p.suffix=='.py':
  tree=ast.parse(raw,filename=name)
  calls=sorted([{'line':n.lineno,'column':n.col_offset,'callee':ast.unparse(n.func),'shape':type(n.func).__name__} for n in ast.walk(tree) if isinstance(n,ast.Call)],key=lambda r:(r['line'],r['column'],r['callee']))
  expected=[{'line':e['line'],'column':e['column'],'callee':e['callee'],'shape':e['shape']} for e in known_calls if e['file']==name]
  assert calls==expected,f'AST inventory drift: {name}'
  imports=[];attrs=[];dynamic=[]
  for n in ast.walk(tree):
   if isinstance(n,(ast.Import,ast.ImportFrom)):imports.append({'line':n.lineno,'source':ast.unparse(n)})
   if isinstance(n,ast.Call):
    if isinstance(n.func,ast.Attribute):attrs.append({'line':n.lineno,'callee':ast.unparse(n.func),'receiver':ast.unparse(n.func.value)})
    if isinstance(n.func,(ast.Call,ast.Subscript,ast.Lambda)) or (isinstance(n.func,ast.Name) and n.func.id in ('eval','exec','getattr','setattr','delattr','__import__')):dynamic.append({'line':n.lineno,'callee':ast.unparse(n.func)})
  row.update({'call_sites':calls,'imports':imports,'attribute_dispatch_candidates':attrs,'dynamic_dispatch_candidates':dynamic,'unresolved_semantics':'Runtime aliasing, receiver types, decorators, imported wrappers and dynamic code not resolved'})
  pycount+=len(calls)
 else:
  # GCC lowering is compiler-derived, but contains names rather than source
  # locations; lexical queue sites are kept as a separate source-level ledger.
  row.update({'gcc_lowered_name_candidates':compiled[name],
    'authority_queue_sites':[{'line':e['line'],'apis':e['apis'],'syntax_disposition':e['syntax_disposition']} for e in queue if e['file']==name],
    'unresolved_semantics':'GCC name candidates lack source locations; indirect targets, macro expansion and cross-TU linkage not proven'})
 rows.append(row)
assert pycount==len(known_calls)==1379
assert sum(len(r.get('authority_queue_sites',[])) for r in rows)==len(queue)==50
# Historical 63 identities are explicitly linked, not silently mapped to
# current line numbers (they belong to a different revision).
assert original['omitted_line_identities']==63
report={'scope':'A03-02 all 54 reviewed translation units operation candidate ledger','reviewed_revision':REV,'files':54,'python_files':24,'c_files':30,'python_ast_calls':pycount,'c_known_authority_queue_sites':len(queue),'historical_63_reference':'ge04-a03-original-63-identities.json','entries':rows,'result':'BIDIRECTIONAL_CANDIDATE_COVERAGE_PINNED; SEMANTIC_COMPLETENESS_NOT_PROVEN','open_gaps':['C source-level provenance for compiler calls, macro expansion and function-pointer targets','Python runtime attribute receivers, alias chains, decorators and dynamic dispatch','Cross-TU and cross-language wrappers and authority effects','Unknown sensitive APIs beyond current author vocabulary','Reviewed per-TU API allowlists and individual site verdicts not provided'],'security_hold':'ACTIVE'}
out=DOC/'ge04-a03-02-operation-ledger.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'A03-02 operation ledger drift'
print(f'A03-02: {len(rows)}/54 source-pinned units, {pycount} Python calls, {len(queue)} C queue sites; semantic closure remains OPEN')
