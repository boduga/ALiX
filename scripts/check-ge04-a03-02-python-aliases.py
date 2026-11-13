#!/usr/bin/env python3
"""Conservative Python import/assignment alias resolver with adversarial fixtures.

Only module-level unambiguous aliases are resolved. Function-local or mutable
bindings, attribute receiver types and dynamic dispatch remain unresolved.
"""
import ast,hashlib,json,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];BASE=ROOT/'native/ge04';DOC=ROOT/'docs/security'
REV='f748ea2e3030bec9d1e3fa375374663721e7496a'
def dotted(node):
 if isinstance(node,ast.Name):return node.id
 if isinstance(node,ast.Attribute):
  parent=dotted(node.value)
  return parent+'.'+node.attr if parent else None
 return None
def resolve(text):
 tree=ast.parse(text);bindings={};tainted=set();defined=set();events=[]
 # Multiple writes make a name mutable; do not assert a stable target.
 writes={}
 for node in tree.body:
  if isinstance(node,ast.Import):
   for a in node.names:
    key=a.asname or a.name.split('.')[0];writes.setdefault(key,[]).append((node.lineno,a.name if a.asname else a.name.split('.')[0]))
  elif isinstance(node,ast.ImportFrom):
   for a in node.names:
    if a.name!='*':writes.setdefault(a.asname or a.name,[]).append((node.lineno,(node.module or '')+'.'+a.name))
  elif isinstance(node,ast.Assign):
   for target in node.targets:
    if isinstance(target,ast.Name):writes.setdefault(target.id,[]).append((node.lineno,dotted(node.value)))
  elif isinstance(node,ast.AnnAssign) and isinstance(node.target,ast.Name):writes.setdefault(node.target.id,[]).append((node.lineno,dotted(node.value)))
  elif isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef)):
   defined.add(node.name);writes.setdefault(node.name,[]).append((node.lineno,None))
  elif isinstance(node,(ast.AugAssign,ast.Delete,ast.For,ast.AsyncFor,ast.With,ast.AsyncWith,ast.Try,ast.If,ast.While,ast.Match)):
   # Control flow and nested writes are not assumed immutable.
   for n in ast.walk(node):
    if isinstance(n,ast.Name) and isinstance(n.ctx,(ast.Store,ast.Del)):tainted.add(n.id)
 for key,items in writes.items():
  if len(items)!=1 or key in tainted:tainted.add(key)
  else:bindings[key]=items[0][1]
 def follow(expr):
  parts=expr.split('.');seen=set();head=parts[0]
  while head in bindings and head not in seen and bindings[head] is not None:
   seen.add(head);replacement=bindings[head];parts=replacement.split('.')+parts[1:];head=parts[0]
  if head in seen or head in tainted:return None
  return '.'.join(parts)
 calls=[]
 parent={}
 for ancestor in ast.walk(tree):
  for child in ast.iter_child_nodes(ancestor):parent[child]=ancestor
 for n in ast.walk(tree):
  if not isinstance(n,ast.Call):continue
  target=dotted(n.func);resolved=follow(target) if target else None
  scope=n
  while scope in parent:
   scope=parent[scope]
   if isinstance(scope,(ast.FunctionDef,ast.AsyncFunctionDef,ast.Lambda,ast.ClassDef)):
    resolved=None;break
  if target and target.split('.')[0] in writes and writes[target.split('.')[0]][0][0]>n.lineno:resolved=None
  if isinstance(n.func,ast.Attribute) and not isinstance(n.func.value,ast.Name):resolved=None
  if target and target.split('.')[0] in defined:resolved=None
  calls.append({'line':n.lineno,'column':n.col_offset,'expression':ast.unparse(n.func),'resolved_static_target':resolved if resolved!=target else None,'status':'STATIC_ALIAS_TARGET' if resolved and resolved!=target else 'UNRESOLVED_OR_DIRECT','reason':'Target not assumed runtime-stable; static resolution only' if not resolved else 'Unambiguous module-level import/assignment chain'})
 return {'calls':sorted(calls,key=lambda x:(x['line'],x['column'])),'ambiguous_bindings':sorted(tainted),'module_bindings':{k:v for k,v in sorted(bindings.items()) if v}}
# Negative controls: mutable aliases, dynamic getters, local scopes cannot be approved.
assert any(x['resolved_static_target']=='os.unlink' for x in resolve('import os as o\na=o.unlink\na("x")')['calls'])
assert any(x['resolved_static_target']=='os.unlink' for x in resolve('import os as o\na=o.unlink\nb=a\nb("x")')['calls'])
assert all(x['resolved_static_target'] is None for x in resolve('import os as o\no=object()\no.unlink("x")')['calls'])
assert all(x['resolved_static_target'] is None for x in resolve('import os\nf=getattr(os,"unlink")\nf("x")')['calls'] if x['expression']=='f')
assert all(x['resolved_static_target'] is None for x in resolve('def f():\n import os as o\n o.unlink("x")')['calls'])
assert all(x['resolved_static_target'] is None for x in resolve('o.unlink("x")\nimport os as o')['calls'])
assert all(x['resolved_static_target'] is None for x in resolve('import os as o\ndef f(o):\n o.unlink("x")')['calls'])
rows=[]
for p in sorted(BASE.glob('*.py')):
 raw=p.read_bytes();old=subprocess.run(['git','show',f'{REV}:native/ge04/{p.name}'],cwd=ROOT,capture_output=True,check=True).stdout
 assert raw==old,p.name
 data=resolve(raw.decode());rows.append({'file':p.name,'sha256':hashlib.sha256(raw).hexdigest(),**data})
report={'scope':'A03-02 conservative Python static alias provenance across 24 files','reviewed_revision':REV,'files':len(rows),'calls':sum(len(r['calls']) for r in rows),'statically_resolved_alias_calls':sum(x['status']=='STATIC_ALIAS_TARGET' for r in rows for x in r['calls']),'entries':rows,'adversarial_fixtures':'PASS: import alias, assignment chain, reassignment, getattr and function-local imports','status':'STATIC_ALIAS_CANDIDATES_ONLY; DYNAMIC_AND_RECEIVER_DISPATCH_UNRESOLVED','limitations':['Module-level assignments can still be mutated by external code or runtime hooks','Attribute receivers are not type-resolved','Control-flow, function-local and dynamic dispatch remain unresolved','Static aliases are not security approval or complete Python call graph'],'security_hold':'ACTIVE'}
assert len(rows)==24 and report['calls']==1379
out=DOC/'ge04-a03-02-python-aliases.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'A03-02 Python alias drift'
print('A03-02 Python aliases:',report['files'],'files;',report['calls'],'calls;',report['statically_resolved_alias_calls'],'static alias candidates; negative fixtures PASS')
