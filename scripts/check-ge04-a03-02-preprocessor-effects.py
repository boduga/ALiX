#!/usr/bin/env python3
"""Source-verified conditional syscall branch links for the historical 63."""
import hashlib,json,re,subprocess,sys
from pathlib import Path
if not __debug__:raise SystemExit('GE-04 evidence check refuses optimized Python: assertions are required')
R=Path(__file__).resolve().parents[1];D=R/'docs/security';B=R/'native/ge04';REV='f748ea2e3030bec9d1e3fa375374663721e7496a'
h=json.loads((D/'ge04-a03-02-historical-kind.json').read_text());entries=[e for e in h['entries'] if e['syntax_kind']=='C_PREPROCESSOR_DIRECTIVE'];assert len(entries)==5
expected={'SYS_renameat2':'RENAME_NOREPLACE','SYS_clone3':'CLONE_INTO_CGROUP','SYS_execveat':'AT_EMPTY_PATH'}
rows=[]
for e in entries:
 f=e['file'];raw=(B/f).read_bytes();assert raw==subprocess.run(['git','show',f'{REV}:native/ge04/{f}'],cwd=R,capture_output=True,check=True).stdout
 lines=raw.decode().splitlines();start=e['current_line'];directive=lines[start-1].strip();tokens=[k for k in expected if k in directive];assert len(tokens)==1,(f,directive)
 symbol=tokens[0];depth=1;end=None;else_line=None
 for i in range(start,len(lines)):
  s=lines[i].strip()
  if re.match(r'^#\s*(if|ifdef|ifndef)\b',s):depth+=1
  elif re.match(r'^#\s*endif\b',s):
   depth-=1
   if depth==0:end=i+1;break
  elif re.match(r'^#\s*else\b',s) and depth==1:else_line=i+1
 assert end is not None
 branch=lines[start: (else_line-1 if else_line else end-1)]
 calls=[{'line':i,'source':lines[i-1].strip()} for i in range(start+1,(else_line or end)) if re.search(r'\bsyscall\s*\(\s*'+re.escape(symbol)+r'\b',lines[i-1])]
 assert len(calls)==1,(f,start,symbol,calls)
 assert expected[symbol] in '\n'.join(branch),(f,start,symbol,'expected effect parameter missing')
 rows.append({'file':f,'directive_line':start,'directive':directive,'conditional_syscall':symbol,'call':calls[0],'conditional_branch_end':end,'else_line':else_line,'effect_parameter':expected[symbol],'source_sha256':hashlib.sha256(raw).hexdigest(),'source_branch_link':'EXACT_SOURCE_SYSCALL_LINK','runtime_execution_proven':False,'security_verdict':'PENDING'})
assert len(rows)==5
report={'scope':'A03-02 conditional syscall effects for five historical C preprocessor references','reviewed_revision':REV,'entries':rows,'exact_source_conditional_syscall_links':5,'runtime_effects_verified':0,'limitations':['Conditional compilation and kernel availability determine actual branch','Source syscall link does not prove privilege, authorization, object identity or failure safety','No native privileged execution or root tests performed'],'security_hold':'ACTIVE'}
out=D/'ge04-a03-02-preprocessor-effects.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'Conditional effect link drift'
print('Conditional syscall source links:',len(rows),'of 5; security clearance 0')
