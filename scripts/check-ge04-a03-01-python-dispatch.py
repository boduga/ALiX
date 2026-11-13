#!/usr/bin/env python3
"""A03-01: AST dispatch and alias evidence for all 18 historical files' Python units.

Conservative static evidence: dynamic targets stay unresolved, never approved.
"""
import ast,hashlib,json,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];DOC=ROOT/'docs/security'
review='f748ea2e3030bec9d1e3fa375374663721e7496a'
source=json.loads((DOC/'ge04-b1a-original-63-reconciliation.json').read_text())
files=sorted(x['file'] for x in source['per_file'] if x['file'].endswith('.py'))
assert len(files)==7
rows=[]
for name in files:
 p=ROOT/'native/ge04'/name;raw=p.read_bytes()
 assert subprocess.run(['git','show',f'{review}:native/ge04/{name}'],cwd=ROOT,capture_output=True,check=True).stdout==raw
 tree=ast.parse(raw,filename=name)
 imports={}; aliases=[];calls=[];dynamic=[];noncall=[]
 for n in ast.walk(tree):
  if isinstance(n,ast.Import):
   for a in n.names:imports[a.asname or a.name.split('.')[0]]=a.name
  elif isinstance(n,ast.ImportFrom):
   for a in n.names:imports[a.asname or a.name]=f'{n.module}.{a.name}'
  elif isinstance(n,(ast.Assign,ast.AnnAssign,ast.NamedExpr)):
   v=n.value
   if isinstance(v,(ast.Name,ast.Attribute,ast.Call,ast.Subscript)):
    aliases.append({'line':n.lineno,'target':ast.unparse(n.targets if isinstance(n,ast.Assign) else n.target),'value':ast.unparse(v)})
  elif isinstance(n,ast.Call):
   f=ast.unparse(n.func);entry={'line':n.lineno,'column':n.col_offset,'callee':f,'shape':type(n.func).__name__}
   if isinstance(n.func,ast.Name) and n.func.id in imports:entry['import_target']=imports[n.func.id]
   elif isinstance(n.func,ast.Attribute) and isinstance(n.func.value,ast.Name) and n.func.value.id in imports:entry['import_target']=imports[n.func.value.id]+'.'+n.func.attr
   calls.append(entry)
   if (isinstance(n.func,ast.Name) and n.func.id in ('getattr','setattr','delattr','eval','exec','__import__','globals','locals')) or (isinstance(n.func,ast.Attribute) and n.func.attr in ('import_module','getattr','__getattribute__')) or isinstance(n.func,(ast.Call,ast.Subscript,ast.Lambda)):
    dynamic.append(entry)
  elif isinstance(n,(ast.Attribute,ast.Subscript)):
   noncall.append({'line':n.lineno,'expr':ast.unparse(n)})
 rows.append({'file':name,'sha256':hashlib.sha256(raw).hexdigest(),'imports':imports,'assignment_alias_candidates':aliases,'calls':calls,'dynamic_dispatch_candidates':dynamic,'attribute_or_subscript_references':noncall})
report={'scope':'A03-01 Python AST dispatch expansion of 7 historical reviewer files','reviewed_revision':review,'files':len(rows),'calls':sum(len(r['calls']) for r in rows),'assignment_alias_candidates':sum(len(r['assignment_alias_candidates']) for r in rows),'dynamic_dispatch_candidates':sum(len(r['dynamic_dispatch_candidates']) for r in rows),'attribute_or_subscript_references':sum(len(r['attribute_or_subscript_references']) for r in rows),'rows':rows,'status':'SOURCE_PINNED_STATIC_DISPATCH_EVIDENCE_NOT_SEMANTIC_COMPLETENESS','limitations':['Attribute receivers and runtime aliases are not proven call targets','Dynamic import and monkeypatch targets remain unresolved','Assignment candidates include ordinary data assignments','C authority and cross-language effects require separate review','No inference of the original 63 missing identities or human site verdicts'],'security_hold':'ACTIVE'}
out=DOC/'ge04-a03-01-python-dispatch.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'Python dispatch audit drift'
print('A03-01 Python:',report['files'],'files,',report['calls'],'calls,',report['assignment_alias_candidates'],'assignment candidates,',report['dynamic_dispatch_candidates'],'dynamic candidates')
