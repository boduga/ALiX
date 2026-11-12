#!/usr/bin/env python3
"""Extend A03-02 wrapper candidate tracing through verified object-symbol edges.

Conservative: a link is usable only if the existing object-symbol test passes.
Unresolved names and absence of sinks never imply benign semantics.
"""
import hashlib,json,re,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];D=ROOT/'docs/security';BASE=ROOT/'native/ge04'
REV='f748ea2e3030bec9d1e3fa375374663721e7496a'
read=lambda n:json.loads((D/n).read_text())
source=read('ge04-a03-02-local-wrapper-effects.json');links=read('ge04-b1a-cross-tu-candidates.json')
assert source['reviewed_revision']==REV and len(links['unique_cross_tu_candidates'])==28 and not links['ambiguous_or_missing']
# Verify that the cross-TU candidate edges actually occur as object symbols.
subprocess.run(['python3','scripts/check-ge04-cross-tu-linkage.py'],cwd=ROOT,check=True,capture_output=True,text=True)
linkmap={}
for e in links['unique_cross_tu_candidates']:
 caller=e['caller'].split(':',1)[0];sym=e['unresolved'].split(':',1)[1];target=e['candidate_targets'][0].split(':',1)[0]
 linkmap[(caller,sym)]=target
# Reconstruct a conservative function-body call inventory. The local report
# already pins the source baseline; no privileged code is executed.
DEF=re.compile(r'(?m)^\s*(?:(?:static|inline|extern|const|unsigned|signed|struct\s+\w+|void|int|long|short|char|size_t|ssize_t|pid_t|bool|[A-Za-z_]\w*\s*\*)\s+)+(?P<name>[A-Za-z_]\w*)\s*\([^;{}]*\)\s*\{')
CALL=re.compile(r'(?<![\w.])([A-Za-z_]\w*)\s*\(')
sensitive={'syscall','clone','clone3','fork','execve','execveat','setresuid','setresgid','setgroups','setuid','setgid','prctl','kill','pidfd_send_signal','unlink','unlinkat','rename','renameat','renameat2','mkdir','mkdirat','rmdir','chmod','fchmod','chown','fchown','open','openat','write','pwrite','fsync','flock','fcntl','mount','umount2','sendmsg','recvmsg','accept4','socket','connect','bind','ioctl','sd_bus_call_method','sd_bus_process','sd_bus_match_signal','close','dup2','dup3'}
functions={}
for p in sorted(BASE.glob('*.c')):
 raw=p.read_bytes();assert raw==subprocess.run(['git','show',f'{REV}:native/ge04/{p.name}'],cwd=ROOT,capture_output=True,check=True).stdout
 src=raw.decode()
 for m in DEF.finditer(src):
  depth=1;i=m.end();start=i
  while i<len(src) and depth:
   if src[i]=='{':depth+=1
   elif src[i]=='}':depth-=1
   i+=1
  if depth==0:functions[(p.name,m['name'])]=set(CALL.findall(src[start:i-1]))-{'if','while','switch','for','sizeof','return'}
rows=[]
for original in source['entries']:
 file=original['file'];symbol=original['symbol'];seen=set();sinks=set();cross=[];unresolved=set()
 def visit(file,symbol,depth):
  if (file,symbol) in seen or depth>16:return
  seen.add((file,symbol));calls=functions.get((file,symbol))
  if calls is None:unresolved.add((file,symbol));return
  for target in sorted(calls):
   if target in sensitive:sinks.add(target)
   elif (file,target) in functions:visit(file,target,depth+1)
   elif (file,target) in linkmap:
    dest=linkmap[(file,target)];cross.append({'from_file':file,'target_file':dest,'symbol':target});visit(dest,target,depth+1)
   else:unresolved.add((file,target))
 visit(file,symbol,0)
 rows.append({'file':file,'symbol':symbol,'candidate_sensitive_sinks':sorted(sinks),'verified_cross_tu_edge_candidates':cross,'unresolved_targets':[{'file':f,'symbol':s} for f,s in sorted(unresolved)],'security_verdict':'PENDING'})
assert len(rows)==source['unlisted_unknown_candidates']
report={'scope':'A03-02 cross-TU wrapper effect candidate tracing through 28 verified object symbol links','reviewed_revision':REV,'candidate_wrappers':len(rows),'verified_object_symbol_references':len(links['unique_cross_tu_candidates']),'distinct_symbol_links':len(linkmap),'wrappers_using_cross_tu_edges':sum(bool(r['verified_cross_tu_edge_candidates']) for r in rows),'wrappers_with_sensitive_sink_candidates':sum(bool(r['candidate_sensitive_sinks']) for r in rows),'rows':rows,'status':'CROSS_TU_SYMBOL_VERIFIED_CANDIDATE_TRACING_NOT_SEMANTIC_COMPLETENESS','limitations':['Symbol linkage validates edges but not all runtime dispatch, macro or transitive behavior','Lexical function extraction can miss definitions and count comments','Unresolved targets and missing sinks remain open; no benign disposition','All site-level security verdicts and A03-02 completeness remain pending'],'security_hold':'ACTIVE'}
out=D/'ge04-a03-02-cross-tu-wrapper-effects.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'A03-02 cross-TU drift'
print('A03-02 cross-TU:',len(links['unique_cross_tu_candidates']),'object-verified references;',len(linkmap),'distinct links;',report['wrappers_using_cross_tu_edges'],'wrappers traversed links;',report['wrappers_with_sensitive_sink_candidates'],'candidate sink paths; OPEN')
