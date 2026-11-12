#!/usr/bin/env python3
"""Classify exact historical source matches by syntax; never imply effect safety."""
import ast,collections,hashlib,json,subprocess,sys
from pathlib import Path
if not __debug__:raise SystemExit('GE-04 evidence check refuses optimized Python: assertions are required')
R=Path(__file__).resolve().parents[1];D=R/'docs/security';B=R/'native/ge04';REV='f748ea2e3030bec9d1e3fa375374663721e7496a'
h=json.loads((D/'ge04-a03-02-historical-current-map.json').read_text());assert h['reviewed_revision']==REV
rows=[];counts=collections.Counter();cache={}
for e in h['entries']:
 f=e['file'];line=e['current_candidate_lines'][0];src=(B/f).read_bytes();assert src==subprocess.run(['git','show',f'{REV}:native/ge04/{f}'],cwd=R,capture_output=True,check=True).stdout
 assert hashlib.sha256(src).hexdigest()==e['reviewed_source_sha256']
 text=src.decode().splitlines()[line-1].strip();assert text==e['historical_source']
 if f.endswith('.py'):
  if f not in cache:
   tree=ast.parse(src);parents={}
   for node in ast.walk(tree):
    for child in ast.iter_child_nodes(node):parents[child]=node
   cache[f]=(tree,parents)
  tree,parents=cache[f];calls=[n for n in ast.walk(tree) if isinstance(n,ast.Call) and n.lineno<=line<=getattr(n,'end_lineno',n.lineno)]
  def in_docstring(n):
   p=parents.get(n)
   return isinstance(p,ast.Expr) and isinstance(n,ast.Constant) and isinstance(n.value,str) and isinstance(parents.get(p),(ast.Module,ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef)) and parents[p].body[0] is p
  docs=[n for n in ast.walk(tree) if isinstance(n,ast.Constant) and getattr(n,'lineno',-1)<=line<=getattr(n,'end_lineno',-1) and in_docstring(n)]
  kind='PYTHON_DOCSTRING_NONCALL' if docs else 'PYTHON_CALL_EXPRESSION' if calls else 'PYTHON_NONCALL_EXPRESSION'
  callees=sorted({ast.unparse(n.func) for n in calls})
 else:
  kind='C_PREPROCESSOR_DIRECTIVE' if text.startswith('#') else 'C_DECLARATION_OR_DEFINITION' if text.startswith(('static int ','int ge04_','ssize_t ge04_')) and '(' in text else 'C_SOURCE_EXPRESSION_REQUIRES_COMPILER_CONTEXT'
  callees=[]
 counts[kind]+=1
 rows.append({'file':f,'historical_line':e['historical_line'],'current_line':line,'source':text,'syntax_kind':kind,'python_ast_callees_spanning_line':callees,'is_proven_authority_effect':False,'semantic_verdict':'PENDING'})
assert len(rows)==63
report={'scope':'GE-04 A03-02 exact historical 63 syntax triage, source-pinned','reviewed_revision':REV,'entries':rows,'counts':dict(sorted(counts.items())),'source_lines_verified':63,'semantically_cleared':0,'limitations':['AST calls spanning a line may be nested or multi-line and do not establish authority','C lexical categories require compiler/preprocessor verification','Noncall expressions can influence authority decisions','Docstrings and preprocessor directives are not executable calls but may reference security effects'],'security_hold':'ACTIVE'}
out=D/'ge04-a03-02-historical-kind.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'Historical syntax triage drift'
print('Historical 63 syntax kinds:',dict(counts),'security clearance 0')
