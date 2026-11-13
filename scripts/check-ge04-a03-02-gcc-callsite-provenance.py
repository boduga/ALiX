#!/usr/bin/env python3
"""A03-02: compile all C translation units and retain GCC GIMPLE source-located call candidates.

No native binary is run. GIMPLE can lower macros and wrappers; unresolved
indirect targets remain explicitly flagged, not treated as safe.
"""
import hashlib,json,re,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];BASE=ROOT/'native/ge04';DOC=ROOT/'docs/security'
REV='f748ea2e3030bec9d1e3fa375374663721e7496a'
# Match location-prefixed statements, excluding conditions and declarations.
LOC=re.compile(r'\[(?:[^\]\n]*?/)?(?P<file>[\w-]+\.c):(?P<line>\d+):(?P<col>\d+)\]')
CALL=re.compile(r'(?P<target>(?:\(\s*\*\s*)?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?)\s*\(')
rows=[];failed=[]
with tempfile.TemporaryDirectory(prefix='ge04-a03-gimple-') as tmp:
 for p in sorted(BASE.glob('*.c')):
  raw=p.read_bytes();old=subprocess.run(['git','show',f'{REV}:native/ge04/{p.name}'],cwd=ROOT,capture_output=True,check=True).stdout
  assert raw==old,f'Baseline source drift: {p.name}'
  work=Path(tmp)/p.stem;work.mkdir()
  cmd=['gcc','-std=gnu11','-O0','-I',str(BASE),'-fdump-tree-gimple-lineno','-c',str(p),'-o','probe.o']
  result=subprocess.run(cmd,cwd=work,capture_output=True,text=True)
  if result.returncode:failed.append({'file':p.name,'error':result.stderr[-1200:]});continue
  dumps=list(work.glob('*.gimple'))
  assert len(dumps)==1,(p.name,dumps)
  sites=[]
  for line in dumps[0].read_text().splitlines():
   if not LOC.search(line):continue
   # Strip bracketed source locations to identify GIMPLE expression.
   stmt=re.sub(r'\[[^\]\n]*?\.c:\d+:\d+\]\s*','',line).strip()
   if not stmt or stmt.startswith(('if ','switch ','case ','goto ','return ','#')):continue
   m=CALL.search(stmt)
   if not m:continue
   locs=[{'file':x['file'],'line':int(x['line']),'column':int(x['col'])} for x in LOC.finditer(line)]
   # Preserve provenance, including macros lowered to multiple operations.
   target=m['target'];sites.append({'locations':locs,'target_token':target,'gimple_statement':stmt[:350],
     'target_kind':'INDIRECT_OR_COMPUTED' if target.startswith(('_','D.')) or '(*' in stmt else 'NAMED_CANDIDATE'})
  rows.append({'file':p.name,'sha256':hashlib.sha256(raw).hexdigest(),'gimple_call_candidate_count':len(sites),'gimple_call_candidates':sites})
assert not failed,failed
assert len(rows)==30
report={'scope':'A03-02 GCC GIMPLE source-located call candidate evidence','reviewed_revision':REV,'compiler':subprocess.run(['gcc','-dumpfullversion'],capture_output=True,text=True,check=True).stdout.strip(),'files':len(rows),'call_candidates':sum(len(r['gimple_call_candidates']) for r in rows),'entries':rows,'compile_failures':failed,'status':'COMPILER_LOWERED_CALLSITE_CANDIDATES_NOT_COMPLETE_SEMANTIC_AUTHORITY_PROOF','limitations':['GIMPLE lowering can introduce builtin/helper calls and erase high-level macro spelling','Source locations may refer to macro expansion rather than originating token','Regex extracts candidate GIMPLE call statements, not a verified compiler IR call graph','Indirect function-pointer targets and cross-TU effects remain unresolved','Security reviewer must classify every authority effect and negative path'],'security_hold':'ACTIVE'}
out=DOC/'ge04-a03-02-gcc-callsite-provenance.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'GCC GIMPLE provenance drift'
print('A03-02 GCC provenance:',report['files'],'compiled C files;',report['call_candidates'],'source-located GIMPLE call candidates; no native execution')
