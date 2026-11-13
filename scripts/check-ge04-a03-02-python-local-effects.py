#!/usr/bin/env python3
"""Trace source-pinned Python module-local functions to risk-named calls.

AST function definitions and call edges only. Receiver types, import targets,
mutations and dynamic dispatch are deliberately unresolved.
"""
import ast,hashlib,json,re,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];BASE=ROOT/'native/ge04';D=ROOT/'docs/security'
REV='f748ea2e3030bec9d1e3fa375374663721e7496a'
triage=json.loads((D/'ge04-a03-02-python-effect-triage.json').read_text())
by_file={r['file']:r for r in triage['entries']}
SINK=re.compile(r'(?:^|\.)(?:set(?:res|re|e)?(?:uid|gid)|setgroups|fork|exec\w*|spawn\w*|kill|terminate|wait|poll|pidfd\w*|Popen|run|system|prctl|unshare|setns|open|close|read|write|pread|pwrite|unlink|remove|rmdir|mkdir|rename|replace|chmod|chown|fchmod|fchown|fstat|stat|lstat|fsync|fdatasync|dup|dup2|memfd_create|sendmsg|recvmsg|socket|connect|accept|register|unregister|set_blocking|fileno|Subscribe|Unsubscribe|add_signal_receiver|remove_signal_receiver|get_name_owner|get_unix_user|get_object|BusConnection|Interface|StartTransientUnit|StopUnit|KillUnit|call_blocking|eval|exec|__import__|getattr|setattr|delattr)$')
def analyze(src):
 tree=ast.parse(src)
 defs={n.name:n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))}
 # Only calls to direct module-level definitions are traversed. Any name
 # written outside its definition (including function scopes) invalidates
 # the unambiguous binding assumption.
 shadow=set()
 for n in ast.walk(tree):
  if isinstance(n,(ast.Name,)) and isinstance(n.ctx,(ast.Store,ast.Del)) and n.id in defs:shadow.add(n.id)
  if isinstance(n,(ast.Import,ast.ImportFrom)):
   for a in n.names:
    name=a.asname or (a.name.split('.')[0] if isinstance(n,ast.Import) else a.name)
    if name in defs:shadow.add(name)
 def names(fn):
  # Exclude nested definitions from the outer function's call body.
  calls=[]
  def visit(node):
   if node is not fn and isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef,ast.Lambda,ast.ClassDef)):return
   if isinstance(node,ast.Call):calls.append(ast.unparse(node.func))
   for child in ast.iter_child_nodes(node):visit(child)
  for statement in fn.body:visit(statement)
  return sorted(set(calls))
 graph={name:names(fn) for name,fn in defs.items()}
 def walk(name,seen):
  if name in seen or name not in graph or name in shadow:return set(),set(),set()
  seen=seen|{name};sinks=set();edges=set();unknown=set()
  for callee in graph[name]:
   if SINK.search(callee):sinks.add(callee)
   elif callee in graph and callee not in shadow:
    edges.add((name,callee));s,e,u=walk(callee,seen);sinks|=s;edges|=e;unknown|=u
   else:unknown.add(callee)
  return sinks,edges,unknown
 return defs,shadow,graph,walk
fixture='''def outer():\n return inner()\ndef inner():\n return os.unlink("x")\n'''
d,shadow,graph,walk=analyze(fixture)
assert 'os.unlink' in walk('outer',set())[0]
assert 'outer' in analyze('def outer():\n return os.open("x")\n')[0]
assert not analyze('def outer():\n return unknown()\n')[3]('outer',set())[0]
files=[];total=0;with_sinks=0
for p in sorted(BASE.glob('*.py')):
 raw=p.read_bytes();assert raw==subprocess.run(['git','show',f'{REV}:native/ge04/{p.name}'],cwd=ROOT,capture_output=True,check=True).stdout
 defs,shadow,graph,walk=analyze(raw.decode());entries=[]
 for site in by_file[p.name]['entries']:
  expr=site['expression'];kind='NOT_DIRECT_LOCAL_FUNCTION'
  sinks=set();edges=set();unknown=set()
  if expr in defs and expr not in shadow:
   kind='STATIC_LOCAL_FUNCTION_CANDIDATE';sinks,edges,unknown=walk(expr,set())
  elif expr in defs:kind='SHADOWED_LOCAL_FUNCTION_UNRESOLVED'
  if kind=='STATIC_LOCAL_FUNCTION_CANDIDATE':total+=1;with_sinks+=bool(sinks)
  entries.append({'line':site['line'],'column':site['column'],'expression':expr,'binding_kind':kind,'candidate_sensitive_callees':sorted(sinks),'local_call_edges':[{'from':a,'to':b} for a,b in sorted(edges)],'unresolved_callees':sorted(unknown),'security_verdict':'PENDING'})
 files.append({'file':p.name,'source_sha256':hashlib.sha256(raw).hexdigest(),'local_functions':len(defs),'shadowed_definitions':sorted(shadow),'entries':entries})
assert len(files)==24 and sum(len(f['entries']) for f in files)==triage['gap_callsite_occurrences']==1377
report={'scope':'A03-02 Python AST local function transitive candidate effect tracing','reviewed_revision':REV,'files':len(files),'gap_callsite_occurrences':1377,'static_local_function_callsite_candidates':total,'static_local_callsite_candidates_with_sensitive_callees':with_sinks,'entries':files,'fixture':'PASS: local two-hop function to os.unlink; unknown callee not marked as sink','status':'AST_LOCAL_FUNCTION_EFFECT_CANDIDATES_NOT_SEMANTIC_PROOF','limitations':['AST direct-name matching is not runtime binding or import provenance proof','Receiver methods, decorators, monkeypatching, dynamic calls, imports and cross-language effects unresolved','Risk-named callee is not proof of a sensitive effect; absent sink does not imply safety','Every site and A03-02 semantic completeness remain pending'],'security_hold':'ACTIVE'}
out=D/'ge04-a03-02-python-local-effects.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'Python local effect drift'
print('A03-02 Python local:',total,'direct local callsite candidates;',with_sinks,'with risk-named callees; all pending')
