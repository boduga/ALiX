#!/usr/bin/env python3
"""Probe GCC GIMPLE for indirect C dispatch, with a positive adversarial fixture.

Source-pinned static evidence, not a claim of pointer-target completeness.
"""
import hashlib,json,re,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];BASE=ROOT/'native/ge04';DOC=ROOT/'docs/security'
REV='f748ea2e3030bec9d1e3fa375374663721e7496a'
LOC=re.compile(r'\[(?:[^\]\n]*?/)?([\w-]+\.c):(\d+):(\d+)\]')
STMT=re.compile(r'^(?:[\w.]+\s*=\s*)?(?P<target>[A-Za-z_]\w*)\s*\(')
DECL=re.compile(r'^\s*(?:extern\s+)?(?:static\s+)?(?:inline\s+)?(?:void|int|long|short|char|size_t|ssize_t|pid_t|bool|unsigned|struct\s+\w+)(?:\s+|\s*\*\s*)(?P<name>[A-Za-z_]\w*)\s*\(')
def analyze(raw):
 lines=raw.splitlines();known=set()
 for line in lines:
  m=DECL.match(line)
  if m:known.add(m['name'])
 # This classifier distinguishes a named call from a local function pointer
 # only if GIMPLE has an assignment to that target within the same function.
 function='';ptrs=set();out=[]
 for line in lines:
  if re.match(r'^\w[\w\s*]*\([^;]*\)\s*$',line.strip()) and not line.lstrip().startswith('['):
   function=line.strip();ptrs=set()
  if line.strip()=='}':ptrs=set()
  clean=re.sub(r'\[[^\]\n]*?\.c:\d+:\d+\]\s*','',line).strip()
  if clean.startswith(('//','/*')):continue
  assignment=re.match(r'^(?P<lhs>[A-Za-z_]\w*)\s*=\s*(?:&\s*)?(?P<rhs>[A-Za-z_]\w*)\s*;',clean)
  if assignment and assignment['lhs'] not in known and assignment['rhs'] in known:ptrs.add(assignment['lhs'])
  match=STMT.match(clean)
  if not match:continue
  target=match['target']
  if target in ('if','return','switch','while','sizeof'):continue
  if target in ptrs or (target not in known and re.match(r'^(?:fp|callback|handler|fn|cb)(?:_|[A-Z0-9]|$)\w*$',target)):
   out.append({'target':target,'source_locations':[{'file':x[0],'line':int(x[1]),'column':int(x[2])} for x in LOC.findall(line)],'statement':clean[:250], 'classification':'POTENTIAL_INDIRECT_DISPATCH_UNRESOLVED'})
 return out
fixture='''int sink(int x)\n{\n return x;\n}\nint run(int x)\n{\n int (*fp)(int);\n fp = sink;\n D.1 = fp (x);\n return D.1;\n}\n'''
assert any(x['target']=='fp' for x in analyze(fixture))
assert not analyze('int run(int x)\n{\n D.1 = close (x);\n}\n')
rows=[]
with tempfile.TemporaryDirectory(prefix='ge04-c-indirect-') as temp:
 for p in sorted(BASE.glob('*.c')):
  raw=p.read_bytes();old=subprocess.run(['git','show',f'{REV}:native/ge04/{p.name}'],cwd=ROOT,capture_output=True,check=True).stdout
  assert raw==old,p.name
  wd=Path(temp)/p.stem;wd.mkdir()
  result=subprocess.run(['gcc','-std=gnu11','-O0','-I',str(BASE),'-fdump-tree-gimple-lineno','-c',str(p),'-o','probe.o'],cwd=wd,capture_output=True,text=True)
  assert result.returncode==0,(p.name,result.stderr[-800:])
  dumps=list(wd.glob('*.gimple'));assert len(dumps)==1
  rows.append({'file':p.name,'sha256':hashlib.sha256(raw).hexdigest(),'indirect_candidates':analyze(dumps[0].read_text())})
report={'scope':'A03-02 GCC GIMPLE C indirect-dispatch triage','reviewed_revision':REV,'files':len(rows),'potential_indirect_candidates':sum(len(r['indirect_candidates']) for r in rows),'entries':rows,'fixture':'PASS: function-pointer call flagged; ordinary direct call not flagged','status':'HEURISTIC_POINTER_DISPATCH_TRIAGE_NOT_EXHAUSTIVE','limitations':['Local pointer assignment recognizer is not a compiler-verified points-to analysis','Function pointers in structures, parameters, casts, phi nodes, aliases and macros can evade heuristic','No unresolved pointer candidate is assumed safe; zero findings does not prove absence','Full semantic closure and independent site verdicts remain pending'],'security_hold':'ACTIVE'}
assert len(rows)==30
out=DOC/'ge04-a03-02-c-indirect.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'A03-02 C indirect drift'
print('A03-02 C indirect:',len(rows),'source-pinned units;',report['potential_indirect_candidates'],'potential indirect candidates; fixture PASS; completeness OPEN')
