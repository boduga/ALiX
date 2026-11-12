#!/usr/bin/env python3
"""Source-pinned C-side call/indirect-dispatch candidate inventory for A03-01.

A lexical and GCC-lowered crosswalk, never semantic or security acceptance.
"""
import hashlib,json,re,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];DOC=ROOT/'docs/security';BASE=ROOT/'native/ge04'
review='f748ea2e3030bec9d1e3fa375374663721e7496a'
def read(name):return json.loads((DOC/name).read_text())
original=read('ge04-b1a-original-63-reconciliation.json')
compiled={e['file']:e['lowered_call_name_candidates'] for e in read('ge04-b1a-c-compiler-call-inventory.json')['entries']}
queue=read('ge04-b1a-c-authority-review-queue.json')['entries']
syntax=read('ge04-b1a-c-sensitive-disposition.json')['entries']
files=sorted(e['file'] for e in original['per_file'] if e['file'].endswith('.c'))
assert len(files)==11
# Candidate expressions: direct names, member/function-pointer invocations,
# syscall number arguments, macro invocations and noncall authority constants.
call=re.compile(r'(?<![\w.])(?:\(\s*\*\s*([A-Za-z_]\w*)\s*\)|(?:->|\.)([A-Za-z_]\w*)|\b([A-Za-z_]\w*))\s*\(')
member=re.compile(r'(?:->|\.)([A-Za-z_]\w*)\s*\(')
fp=re.compile(r'\(\s*\*\s*([A-Za-z_]\w*)\s*\)\s*\(')
macro=re.compile(r'^\s*#\s*define\s+([A-Za-z_]\w*)\s*\(')
auth=re.compile(r'\b(?:SYS_[A-Za-z_0-9]+|SCM_RIGHTS|CLONE_[A-Z_0-9]+|LOCK_(?:EX|SH|UN)|SO_PEERCRED|AT_REMOVEDIR|O_(?:EXCL|NOFOLLOW|CLOEXEC)|PR_SET_NO_NEW_PRIVS)\b')
rows=[]
for name in files:
 p=BASE/name;raw=p.read_bytes()
 assert subprocess.run(['git','show',f'{review}:native/ge04/{name}'],cwd=ROOT,capture_output=True,check=True).stdout==raw,name
 lines=raw.decode().splitlines();sites=[]
 for line,text in enumerate(lines,1):
  cs=[{'name':next(v for v in m.groups() if v),'kind':'POINTER' if m.group(1) else 'MEMBER' if m.group(2) else 'NAME'} for m in call.finditer(text)]
  flags=sorted(set(auth.findall(text)))
  macros=macro.findall(text)
  if cs or flags or macros:
   sites.append({'line':line,'text':text,'call_tokens':cs,'authority_flag_tokens':flags,'macro_declarations':macros,'review_state':'UNADJUDICATED_LEXICAL_CANDIDATE'})
 q=[{'line':e['line'],'apis':e['apis']} for e in queue if e['file']==name]
 candidate_lines={e['line'] for e in sites}
 assert all(e['line'] in candidate_lines for e in q),f'Known C authority site missing from expanded lexical inventory: {name}'
 s=[{'line':e['line'],'syntax_disposition':e['syntax_disposition']} for e in syntax if e['file']==name]
 rows.append({'file':name,'sha256':hashlib.sha256(raw).hexdigest(),'line_count':len(lines),'lexical_candidate_sites':sites,'gcc_lowered_name_candidates':compiled[name],'existing_authority_queue':q,'existing_sensitive_syntax':s,'candidate_site_count':len(sites),'function_pointer_syntax_count':sum(c['kind']=='POINTER' for e in sites for c in e['call_tokens']),'member_call_syntax_count':sum(c['kind']=='MEMBER' for e in sites for c in e['call_tokens']),'macro_declaration_count':sum(len(e['macro_declarations']) for e in sites)})
report={'scope':'A03-01 C-side lexical dispatch and authority-reference crosswalk','reviewed_revision':review,'historical_c_files':len(rows),'lexical_candidate_sites':sum(r['candidate_site_count'] for r in rows),'known_authority_queue_sites_covered':sum(len(r['existing_authority_queue']) for r in rows),'function_pointer_syntax':sum(r['function_pointer_syntax_count'] for r in rows),'member_call_syntax':sum(r['member_call_syntax_count'] for r in rows),'macro_declarations':sum(r['macro_declaration_count'] for r in rows),'rows':rows,'result':'SOURCE_PINNED_C_CANDIDATE_INVENTORY_NOT_COMPLETE_SEMANTIC_AUDIT','limitations':['Single-line lexical matches can include comments, declarations, and macro bodies','Multiline calls and macro expansions are not fully resolved','GCC lowered names have no exact source provenance','Function pointer targets and aliases are not resolved','Original 63 omission identities cannot be reconstructed from counts or lexical matches','No site-level authorization, custody, TOCTOU, cleanup or replay verdict inferred'],'security_hold':'ACTIVE'}
out=DOC/'ge04-a03-01-c-dispatch.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'A03-01 C dispatch drift'
print('A03-01 C:',report['historical_c_files'],'files,',report['lexical_candidate_sites'],'candidate lines,',report['function_pointer_syntax'],'pointer syntax,',report['member_call_syntax'],'member syntax')
