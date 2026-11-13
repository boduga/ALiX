#!/usr/bin/env python3
"""Conservative local C wrapper -> sensitive operation trace.

Candidate call edges are lexical and are not treated as a verified call graph.
Every unmatched wrapper remains unresolved rather than safe.
"""
import hashlib,json,re,subprocess,sys
from pathlib import Path
D=Path(__file__).resolve().parents[1]/'docs/security';ROOT=D.parents[1];BASE=ROOT/'native/ge04'
REV='f748ea2e3030bec9d1e3fa375374663721e7496a'
priority=json.loads((D/'ge04-a03-02-authority-priority.json').read_text())
CALL=re.compile(r'(?<![\w.])([A-Za-z_]\w*)\s*\(')
DEF=re.compile(r'(?m)^\s*(?:(?:static|inline|extern|const|unsigned|signed|struct\s+\w+|void|int|long|short|char|size_t|ssize_t|pid_t|bool|[A-Za-z_]\w*\s*\*)\s+)+(?P<name>[A-Za-z_]\w*)\s*\([^;{}]*\)\s*\{')
SENSITIVE={'syscall','clone','clone3','fork','execve','execveat','setresuid','setresgid','setgroups','setuid','setgid','prctl','kill','pidfd_send_signal','unlink','unlinkat','rename','renameat','renameat2','mkdir','mkdirat','rmdir','chmod','fchmod','chown','fchown','open','openat','write','pwrite','fsync','flock','fcntl','mount','umount2','sendmsg','recvmsg','accept4','socket','connect','bind','ioctl','sd_bus_call_method','sd_bus_process','sd_bus_match_signal','close','dup2','dup3'}
def extract(src):
 result={}
 for m in DEF.finditer(src):
  depth=1;i=m.end();start=i
  while i<len(src) and depth:
   if src[i]=='{':depth+=1
   elif src[i]=='}':depth-=1
   i+=1
  if depth==0:result[m['name']]={'line':src.count('\n',0,m.start())+1,'calls':sorted(set(CALL.findall(src[start:i-1]))-{'if','while','switch','for','sizeof','return'}),'body_sha256':hashlib.sha256(src[start:i-1].encode()).hexdigest()}
 return result
assert 'inner' in extract('static int inner(int x) { return open(x); }')
assert extract('static int inner(int x);')=={}
assert 'inner' in extract('static int inner(int x) { if (x) { return close(x); } return 0; }')
byfile={}
for p in sorted(BASE.glob('*.c')):
 raw=p.read_bytes();assert raw==subprocess.run(['git','show',f'{REV}:native/ge04/{p.name}'],cwd=ROOT,capture_output=True,check=True).stdout
 byfile[p.name]=extract(raw.decode())
rows=[]
for item in priority['entries']:
 if 'UNKNOWN_EFFECT_OR_LOCAL_WRAPPER' not in item['triage_categories']:continue
 defs=byfile[item['file']];name=item['symbol'];seen=set();sinks=set();edges=[];missing=set()
 def visit(symbol,depth):
  if symbol in seen or depth>12:return
  seen.add(symbol)
  if symbol not in defs:missing.add(symbol);return
  for callee in defs[symbol]['calls']:
   if callee==symbol:continue
   edges.append({'from':symbol,'to':callee})
   if callee in SENSITIVE:sinks.add(callee)
   elif callee in defs:visit(callee,depth+1)
   else:missing.add(callee)
 visit(name,0)
 rows.append({'file':item['file'],'symbol':name,'definition_line':defs.get(name,{}).get('line'),'definition_body_sha256':defs.get(name,{}).get('body_sha256'),'candidate_sensitive_sinks':sorted(sinks),'candidate_edges':edges,'unresolved_external_or_unknown_targets':sorted(missing),'classification':'POTENTIAL_SENSITIVE_WRAPPER' if sinks else 'UNRESOLVED_WRAPPER_OR_EXTERNAL','security_verdict':'PENDING'})
assert len(rows)==priority['category_counts']['UNKNOWN_EFFECT_OR_LOCAL_WRAPPER']
report={'scope':'A03-02 source-pinned local C wrapper candidate effect paths','reviewed_revision':REV,'files':30,'unlisted_unknown_candidates':len(rows),'candidate_sensitive_wrappers':sum(bool(r['candidate_sensitive_sinks']) for r in rows),'without_confirmed_sensitive_sink':sum(not r['candidate_sensitive_sinks'] for r in rows),'entries':rows,'fixture':'PASS: nested function body and direct sensitive call extracted; declaration excluded','status':'LEXICAL_WRAPPER_TRACE_NOT_SEMANTIC_COMPLETENESS','limitations':['Regex function extraction is not a C parser; comments, macros and complex declarators may be missed','Call edges are lexical; function pointers, aliases and cross-TU effects remain unresolved','Missing sensitive sink is NOT a benign verdict','All original authority site verdicts remain pending','No privileged native binary executed'],'security_hold':'ACTIVE'}
out=D/'ge04-a03-02-local-wrapper-effects.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'wrapper evidence drift'
print('A03-02 local wrappers:',len(rows),'unknown candidates;',report['candidate_sensitive_wrappers'],'with sensitive sink candidates;',report['without_confirmed_sensitive_sink'],'still unresolved')
