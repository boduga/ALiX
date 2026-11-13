#!/usr/bin/env python3
"""Fail-closed C pointer-dispatch source inventory, including callback parameters.

This supplements, rather than replaces, GCC callsite provenance. Static
lexical patterns cannot establish the absence of computed dispatch.
"""
import hashlib,json,re,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];BASE=ROOT/'native/ge04';DOC=ROOT/'docs/security'
REV='f748ea2e3030bec9d1e3fa375374663721e7496a'
# Recognize common C function pointer declarators and indirect expressions.
DECL=re.compile(r'\(\s*\*\s*(?P<name>[A-Za-z_]\w*)\s*\)\s*\(')
CALL=re.compile(r'(?<![\w.])(?P<name>[A-Za-z_]\w*)\s*\(')
DEREF=re.compile(r'\(\s*\*\s*(?P<name>[A-Za-z_]\w*)\s*\)\s*\(')
MEMBER=re.compile(r'(?:->|\.)\s*(?P<name>[A-Za-z_]\w*)\s*\(')
def scan(text):
 lines=text.splitlines();declared={m['name'] for m in DECL.finditer(text)};entries=[]
 for number,line in enumerate(lines,1):
  for m in DECL.finditer(line):entries.append({'line':number,'symbol':m['name'],'kind':'FUNCTION_POINTER_DECLARATOR','source':line.strip()[:250]})
  for m in DEREF.finditer(line):entries.append({'line':number,'symbol':m['name'],'kind':'DEREFERENCED_CALL_OR_DECLARATOR','source':line.strip()[:250]})
  for m in MEMBER.finditer(line):entries.append({'line':number,'symbol':m['name'],'kind':'MEMBER_CALL_CANDIDATE','source':line.strip()[:250]})
  for m in CALL.finditer(line):
   if m['name'] in declared:entries.append({'line':number,'symbol':m['name'],'kind':'DECLARED_POINTER_CALL_OR_DECLARATOR','source':line.strip()[:250]})
 return entries
fixture='''int run(int (*callback)(int), int x) { return callback(x); }\nstruct ops { int (*execute)(int); };\nint invoke(struct ops *p) { return p->execute(1); }\n'''
found=scan(fixture)
assert any(e['kind']=='DECLARED_POINTER_CALL_OR_DECLARATOR' and e['symbol']=='callback' and e['line']==1 for e in found)
assert any(e['kind']=='MEMBER_CALL_CANDIDATE' and e['symbol']=='execute' and e['line']==3 for e in found)
assert not scan('int run(int x) { return close(x); }')
rows=[]
for p in sorted(BASE.glob('*.c')):
 raw=p.read_bytes();old=subprocess.run(['git','show',f'{REV}:native/ge04/{p.name}'],cwd=ROOT,capture_output=True,check=True).stdout
 assert raw==old,p.name
 rows.append({'file':p.name,'sha256':hashlib.sha256(raw).hexdigest(),'pointer_dispatch_source_candidates':scan(raw.decode())})
counts={k:sum(e['kind']==k for r in rows for e in r['pointer_dispatch_source_candidates']) for k in ['FUNCTION_POINTER_DECLARATOR','DEREFERENCED_CALL_OR_DECLARATOR','MEMBER_CALL_CANDIDATE','DECLARED_POINTER_CALL_OR_DECLARATOR']}
report={'scope':'A03-02 C source-level pointer and member-call triage','reviewed_revision':REV,'files':len(rows),'candidate_counts':counts,'entries':rows,'adversarial_fixture':'PASS: callback parameter and member dispatch detected; direct close call excluded','status':'LEXICAL_TRIAGE_NOT_EXHAUSTIVE_POINTER_ANALYSIS','limitations':['Source lexical matching can include comments and declarations and miss macro-expanded or cast calls','Callback parameters and structure members require points-to analysis even when no candidate appears','This does not certify absence of indirect calls or authority-bearing effects','A03-02 remains open and security hold remains active'],'security_hold':'ACTIVE'}
assert len(rows)==30
out=DOC/'ge04-a03-02-c-pointer-declarations.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'A03-02 C pointer declaration drift'
print('A03-02 C source pointer triage:',len(rows),'files;',counts,'; adversarial fixture PASS')
