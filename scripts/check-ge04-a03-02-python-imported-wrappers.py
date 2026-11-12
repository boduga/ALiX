#!/usr/bin/env python3
"""Source-pinned conservative import-to-definition candidate crosswalk for A03-02.
No import execution, runtime binding assertion, or security disposition.
"""
import ast,hashlib,json,subprocess,sys
from pathlib import Path
R=Path(__file__).resolve().parents[1];B=R/'native/ge04';D=R/'docs/security';REV='f748ea2e3030bec9d1e3fa375374663721e7496a'
triage=json.loads((D/'ge04-a03-02-python-effect-triage.json').read_text());local=json.loads((D/'ge04-a03-02-python-local-effects.json').read_text())
local_sinks={(f['file'],x['expression']):x['candidate_sensitive_callees'] for f in local['entries'] for x in f['entries'] if x['binding_kind']=='STATIC_LOCAL_FUNCTION_CANDIDATE'}
texts={};trees={};definitions={};hashes={}
for p in sorted(B.glob('*.py')):
 raw=p.read_bytes();assert raw==subprocess.run(['git','show',f'{REV}:native/ge04/{p.name}'],cwd=R,check=True,capture_output=True).stdout
 texts[p.stem]=raw.decode();trees[p.stem]=ast.parse(raw);hashes[p.stem]=hashlib.sha256(raw).hexdigest();definitions[p.stem]={n.name for n in trees[p.stem].body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef))}
def resolve_imports(tree,known):
 imports={};writes={};unsafe=set()
 for n in tree.body:
  if isinstance(n,ast.ImportFrom):
   if n.level or n.module not in known:
    for a in n.names:unsafe.add(a.asname or a.name)
    continue
   for a in n.names:
    if a.name=='*':unsafe.add('*');continue
    name=a.asname or a.name;writes[name]=writes.get(name,0)+1;imports[name]=(n.module,a.name,n.lineno)
  elif isinstance(n,ast.Import):
   for a in n.names:
    name=a.asname or a.name.split('.')[0];writes[name]=writes.get(name,0)+1
    if a.name in known:imports[name]=(a.name,None,n.lineno)
  elif isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef)):
   writes[n.name]=writes.get(n.name,0)+1
  else:
   for x in ast.walk(n):
    if isinstance(x,ast.Name) and isinstance(x.ctx,(ast.Store,ast.Del)):
     writes[x.id]=writes.get(x.id,0)+1
 # Conservatively refuse bindings written inside any nested function/class.
 for n in ast.walk(tree):
  if isinstance(n,(ast.Name,)) and isinstance(n.ctx,(ast.Store,ast.Del)) and n.id in imports:
   # Import nodes don't contain ast.Name Store; this covers nested rebindings.
   unsafe.add(n.id)
 return {k:v for k,v in imports.items() if writes.get(k)==1 and k not in unsafe},unsafe
# Negative controls: reassignment and missing source export must not resolve.
assert 'alias' in resolve_imports(ast.parse('from sibling import fn as alias\nalias()'),{'sibling'})[0]
assert 'alias' not in resolve_imports(ast.parse('from sibling import fn as alias\nalias=other\nalias()'),{'sibling'})[0]
assert 'alias' not in resolve_imports(ast.parse('from sibling import fn as alias\ndef f():\n alias=other'),{'sibling'})[0]
rows=[];counts={'SOURCE_DEFINITION_CANDIDATE':0,'SOURCE_MODULE_ATTRIBUTE_CANDIDATE':0,'IMPORT_TARGET_NOT_SOURCE_DEFINED':0,'IMPORT_BINDING_UNRESOLVED':0,'NOT_LOCAL_IMPORT_CALL':0}
for f in triage['entries']:
 stem=Path(f['file']).stem;imports,unsafe=resolve_imports(trees[stem],set(trees));entries=[]
 for site in f['entries']:
  expr=site['expression'];parts=expr.split('.');binding=imports.get(parts[0]);status='NOT_LOCAL_IMPORT_CALL';target=None;sinks=[]
  if binding:
   module,symbol,line=binding
   if site['line']<=line:status='IMPORT_BINDING_UNRESOLVED'
   elif symbol is None and len(parts)==2:
    symbol=parts[1];target=f'{module}.{symbol}'
    status='SOURCE_MODULE_ATTRIBUTE_CANDIDATE' if symbol in definitions[module] else 'IMPORT_TARGET_NOT_SOURCE_DEFINED'
   elif symbol is not None and len(parts)==1:
    target=f'{module}.{symbol}'
    status='SOURCE_DEFINITION_CANDIDATE' if symbol in definitions[module] else 'IMPORT_TARGET_NOT_SOURCE_DEFINED'
   else:status='IMPORT_BINDING_UNRESOLVED'
  elif parts[0] in unsafe:status='IMPORT_BINDING_UNRESOLVED'
  if status in ('SOURCE_DEFINITION_CANDIDATE','SOURCE_MODULE_ATTRIBUTE_CANDIDATE'):
   module,symbol=target.split('.',1);sinks=local_sinks.get((module+'.py',symbol),[])
  counts[status]+=1
  entries.append({'line':site['line'],'column':site['column'],'expression':expr,'imported_source_target_candidate':target,'resolution':status,'source_local_effect_candidates':sinks,'security_verdict':'PENDING'})
 rows.append({'file':f['file'],'source_sha256':hashes[stem],'entries':entries})
assert len(rows)==24 and sum(counts.values())==1377
report={'scope':'A03-02 Python reviewed-source imported wrapper candidates','reviewed_revision':REV,'files':24,'callsite_occurrences':1377,'resolution_counts':counts,'entries':rows,'fixtures':'PASS: imported alias, reassignment and nested rebinding rejection','status':'SOURCE_IMPORT_CANDIDATES_ONLY_SEMANTIC_CLOSURE_OPEN','limitations':['Source definitions are not proof of runtime import identity, path custody or immutable bindings','Only top-level direct source imports and module attributes are eligible','Local function sink evidence is a candidate crosswalk, not full imported transitive call graph','Star imports, re-exports, dynamic imports, receiver methods and runtime monkeypatching unresolved','All site dispositions pending; security hold active'],'security_hold':'ACTIVE'}
out=D/'ge04-a03-02-python-imported-wrappers.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'Python imported wrapper drift'
print('A03-02 Python import candidate crosswalk:',counts,'OPEN')
