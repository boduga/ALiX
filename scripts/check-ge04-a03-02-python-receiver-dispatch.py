#!/usr/bin/env python3
"""Conservative AST receiver and dynamic dispatch provenance for A03-02.
All findings are candidates, never runtime identity or authorization verdicts.
"""
import ast,hashlib,json,subprocess,sys
from pathlib import Path
R=Path(__file__).resolve().parents[1];B=R/'native/ge04';D=R/'docs/security';REV='f748ea2e3030bec9d1e3fa375374663721e7496a'
triage=json.loads((D/'ge04-a03-02-python-effect-triage.json').read_text());imported=json.loads((D/'ge04-a03-02-python-imported-wrappers.json').read_text())
def analyze(src,sites):
 tree=ast.parse(src);parent={}
 for a in ast.walk(tree):
  for c in ast.iter_child_nodes(a):parent[c]=a
 def enclosing(n):
  cur=n
  while cur in parent:
   cur=parent[cur]
   if isinstance(cur,(ast.FunctionDef,ast.AsyncFunctionDef,ast.Lambda)):return cur
  return tree
 def bindings(scope,name):
  result=[]
  def visit(n):
   if n is not scope and isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef,ast.Lambda)):return
   if isinstance(n,(ast.Assign,ast.AnnAssign,ast.NamedExpr)):
    targets=n.targets if isinstance(n,ast.Assign) else [n.target]
    for t in targets:
     if isinstance(t,ast.Name) and t.id==name:result.append((n.lineno,ast.unparse(n.value)))
   elif isinstance(n,(ast.For,ast.AsyncFor,ast.With,ast.AsyncWith)):
    # Unknown bindings are not silently ignored.
    if any(isinstance(x,ast.Name) and x.id==name and isinstance(x.ctx,ast.Store) for x in ast.walk(n)):result.append((n.lineno,'DYNAMIC_SCOPE_BINDING'))
   for c in ast.iter_child_nodes(n):visit(c)
  visit(scope);return sorted(set(result))
 by_pos={(n.lineno,n.col_offset,ast.unparse(n.func)):n for n in ast.walk(tree) if isinstance(n,ast.Call)}
 rows=[]
 for s in sites:
  n=by_pos[(s['line'],s['column'],s['expression'])];expr=s['expression'];kind='NOT_RECEIVER_OR_DYNAMIC';receiver=None;origins=[];dynamic=[]
  if isinstance(n.func,ast.Attribute):
   kind='RECEIVER_PROVENANCE_CANDIDATE';receiver=ast.unparse(n.func.value)
   if isinstance(n.func.value,ast.Name):
    name=n.func.value.id;scope=enclosing(n)
    origins=[{'line':line,'initializer':value} for line,value in bindings(scope,name) if line<n.lineno]
    # Function argument or non-local names are not claimed resolved.
    if not origins:kind='RECEIVER_ORIGIN_UNRESOLVED'
    if len(origins)>1:kind='MULTIPLE_RECEIVER_ORIGINS_UNRESOLVED'
   else:kind='COMPOUND_RECEIVER_UNRESOLVED'
  elif isinstance(n.func,ast.Call):
   kind='DYNAMIC_DISPATCH';callee=ast.unparse(n.func.func)
   if callee=='getattr' and len(n.func.args)>=2:
    obj=ast.unparse(n.func.args[0]);selector=n.func.args[1]
    if isinstance(selector,ast.Constant) and isinstance(selector.value,str):dynamic=[selector.value]
    elif isinstance(selector,ast.Name):
     scope=enclosing(n)
     # Find literal loop iterator values only; no runtime enumeration.
     for loop in ast.walk(scope):
      if isinstance(loop,ast.For) and isinstance(loop.target,ast.Name) and loop.target.id==selector.id and isinstance(loop.iter,(ast.Tuple,ast.List)) and all(isinstance(x,ast.Constant) and isinstance(x.value,str) for x in loop.iter.elts):dynamic=sorted({x.value for x in loop.iter.elts})
    receiver=obj;origins=[{'line':line,'initializer':value} for line,value in bindings(enclosing(n),obj) if line<n.lineno] if obj.isidentifier() else []
  rows.append({'line':s['line'],'column':s['column'],'expression':expr,'kind':kind,'receiver_expression':receiver,'receiver_initializers_before_call':origins,'dynamic_selector_literal_candidates':dynamic,'runtime_receiver_verified':False,'security_verdict':'PENDING'})
 return rows
# Negative fixtures: variable selectors and ambiguous receiver writes never become verified.
fx=analyze('def f():\n m=bus.get()\n m=other()\n m.Subscribe()\n getattr(m, choice)()\n',[{'line':4,'column':1,'expression':'m.Subscribe'},{'line':5,'column':1,'expression':'getattr(m, choice)'}])
assert fx[0]['kind']=='MULTIPLE_RECEIVER_ORIGINS_UNRESOLVED' and not fx[1]['dynamic_selector_literal_candidates']
assert all(not x['runtime_receiver_verified'] for x in fx)
fixed=analyze('def f():\n for method in ("GetUnit","GetUnitFileState"):\n  getattr(manager, method)("x")\n',[{'line':3,'column':2,'expression':'getattr(manager, method)'}])
assert fixed[0]['dynamic_selector_literal_candidates']==['GetUnit','GetUnitFileState']
files=[];counts={};selectors=[]
for f in triage['entries']:
 p=B/f['file'];raw=p.read_bytes();assert raw==subprocess.run(['git','show',f'{REV}:native/ge04/{p.name}'],cwd=R,check=True,capture_output=True).stdout
 rows=analyze(raw.decode(),f['entries'])
 for x in rows:
  counts[x['kind']]=counts.get(x['kind'],0)+1
  if x['dynamic_selector_literal_candidates']:selectors.append({'file':p.name,'line':x['line'],'selector_candidates':x['dynamic_selector_literal_candidates']})
 files.append({'file':p.name,'source_sha256':hashlib.sha256(raw).hexdigest(),'entries':rows})
assert len(files)==24 and sum(counts.values())==1377
report={'scope':'A03-02 Python receiver and dynamic dispatch AST provenance candidates','reviewed_revision':REV,'files':24,'callsite_occurrences':1377,'kind_counts':dict(sorted(counts.items())),'dynamic_literal_selector_candidates':selectors,'entries':files,'fixtures':'PASS: ambiguous receiver reassignment and unknown dynamic selector not verified','status':'RECEIVER_AND_DYNAMIC_CANDIDATES_RUNTIME_IDENTITY_UNRESOLVED','limitations':['Assignments are source-location candidates, not flow-sensitive reaching definitions or runtime receiver types','Imported modules, object mutation, aliases, nested scopes, decorators and monkeypatching remain unresolved','Literal dynamic selector values do not prove receiver identity or D-Bus method effects','All 1377 sites remain pending semantic disposition; A03-02 is open'],'security_hold':'ACTIVE'}
out=D/'ge04-a03-02-python-receiver-dispatch.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'Python receiver-dispatch drift'
print('A03-02 Python receiver/dynamic:',report['kind_counts'],'literal selectors',selectors,'OPEN')
