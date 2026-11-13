#!/usr/bin/env python3
"""Pin historical declaration/definition lines to bounded C function bodies and direct effects."""
import hashlib,json,re,subprocess,sys
from pathlib import Path
if not __debug__:raise SystemExit('GE-04 evidence check refuses optimized Python: assertions are required')
R=Path(__file__).resolve().parents[1];B=R/'native/ge04';D=R/'docs/security';REV='f748ea2e3030bec9d1e3fa375374663721e7496a'
h=json.loads((D/'ge04-a03-02-historical-kind.json').read_text());entries=[e for e in h['entries'] if e['syntax_kind']=='C_DECLARATION_OR_DEFINITION'];assert len(entries)==4
expected={'fixed_root_open':{'open','openat','close'},'ge04_stream_read':{'receive_exact','deadline','check','fail'},'ge04_stream_write':{'send_exact','deadline','fail'}}
rows=[]
for e in entries:
 f=e['file'];raw=(B/f).read_bytes();assert raw==subprocess.run(['git','show',f'{REV}:native/ge04/{f}'],cwd=R,capture_output=True,check=True).stdout
 lines=raw.decode().splitlines();line=e['current_line'];src=lines[line-1].strip();assert src==e['source']
 m=re.search(r'\b(fixed_root_open|ge04_stream_read|ge04_stream_write)\s*\(',src);assert m is not None
 name=m.group(1);declaration=src.endswith(';');body=None;direct=[]
 if not declaration:
  depth=0;started=False;end=None
  for idx in range(line-1,len(lines)):
   text=lines[idx]
   for ch in text:
    if ch=='{':depth+=1;started=True
    if ch=='}':depth-=1
   if started and depth==0:end=idx+1;break
  assert end is not None and end>=line
  body='\n'.join(lines[line-1:end]);direct=sorted(set(re.findall(r'\b([A-Za-z_]\w*)\s*\(',body)))
  assert expected[name].issubset(set(direct)),(name,expected[name]-set(direct))
 else:
  assert name=='fixed_root_open'
 rows.append({'file':f,'line':line,'symbol':name,'kind':'FORWARD_DECLARATION_NO_EFFECT' if declaration else 'FUNCTION_DEFINITION','definition_end_line':end if not declaration else None,'direct_call_name_candidates':direct,'expected_effect_relevant_callees':sorted(expected[name]) if not declaration else [],'source_sha256':hashlib.sha256(raw).hexdigest(),'semantic_status':'SOURCE_FUNCTION_BODY_LINKED_NOT_TRANSITIVE_VERIFIED' if not declaration else 'DECLARATION_ONLY','security_verdict':'PENDING'})
assert len(rows)==4 and sum(x['kind']=='FUNCTION_DEFINITION' for x in rows)==3
report={'scope':'A03-02 historical C function declaration/definition body linkage','reviewed_revision':REV,'entries':rows,'function_definitions_linked':3,'forward_declarations_identified':1,'security_approvals':0,'limitations':['Lexical call names are not resolved symbols or a complete transitive call graph','Function-body source links do not prove authorization, descriptor lifetime, or failure behavior','Forward declaration itself performs no call but its function implementation requires separate review'],'security_hold':'ACTIVE'}
out=D/'ge04-a03-02-historical-definitions.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'Historical definitions drift'
print('Historical C definitions:',report['function_definitions_linked'],'bodies and',report['forward_declarations_identified'],'forward declaration; hold active')
