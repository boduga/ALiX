#!/usr/bin/env python3
"""Recover exact 63 historical reviewer omissions using its session-log scanner.

Scanner preserved at tmp/ge04-a03-independent-review/opencode-session.log
near 'files with omissions: 18 total omitted code lines: 63'. Historical
revision d6e22669 is immutable. No security verdict is implied.
"""
import hashlib,json,re,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];DOC=ROOT/'docs/security'
REV='d6e22669712e90ace6e4439d005c1856901964f3'
KW=['openat(','open(','write(','read(','unlink','rename','mkdir','mount(','unshare','setns','setres','setgroups',
    'sd_bus_call_method','sd_bus_send','sd_bus_match_signal','add_signal_receiver','.Subscribe','.Unsubscribe',
    'socket(','bind(','listen(','accept4','recvmsg','sendmsg','subprocess.Popen','os.open','os.write','os.read',
    'os.mkdir','os.unlink','os.fsync','os.pidfd_open','kill(','ioctl(','syscall(','flock(','fcntl(','ptrace',
    'execve','fork(','clone','waitpid','memfd_create','SCM_RIGHTS','chmod(','unlinkat(','mkdirat(','renameat']
def historical(path):
 return subprocess.run(['git','show',f'{REV}:{path}'],cwd=ROOT,capture_output=True,check=True).stdout
matrix=historical('docs/security/ge04-b1a-source-authority-review-matrix.md').decode()
listed={};cur=None
for line in matrix.splitlines():
 m=re.match(r'^### `([^`]+)`',line)
 if m:cur=m[1];listed[cur]=set();continue
 m=re.match(r'^- L(\d+):',line)
 if m and cur:listed[cur].add(int(m[1]))
review=json.loads((DOC/'ge04-b1a-original-63-reconciliation.json').read_text())
counts={e['file']:e['reviewer_reported_omitted_lines'] for e in review['per_file']}
rows=[];per={};sha={}
for f in sorted(listed):
 try:raw=historical('native/ge04/'+f)
 except subprocess.CalledProcessError:continue
 sha[f]=hashlib.sha256(raw).hexdigest();found=[]
 for i,line in enumerate(raw.decode().splitlines(),1):
  s=line.strip()
  if not s or s.startswith(('/*','*','//','#include')) or (f.endswith('.py') and s.startswith('#')):continue
  s=re.sub(r'/\*.*?\*/','',s)
  hits=[k for k in KW if k in s]
  if hits and i not in listed[f]:
   found.append({'file':f,'line':i,'matched_keyword':hits[0],'all_matched_keywords':hits,'historical_source':s,'line_sha256':hashlib.sha256(line.encode()).hexdigest(),'review_disposition':'NOT_SITE_ADJUDICATED'})
 if found:per[f]=len(found);rows+=found
assert per==counts,(per,counts)
assert len(rows)==63 and len(per)==18
assert len({(e['file'],e['line']) for e in rows})==63
for ex in review['explicit_example_rows']:
 # Reviewer examples sometimes reference a line range; at least one exact
 # historical line from each example must appear in the recovered identities.
 raw=ex['reviewer_historical_line_text']
 nums=[int(n) for n in re.findall(r'\d+',raw)]
 assert any((ex['file'],n) in {(r['file'],r['line']) for r in rows} for n in nums),(ex['file'],raw)
report={'scope':'GE-04 A03-01 exact historical 63 omitted-line identities','historical_revision':REV,'matrix_sha256':hashlib.sha256(historical('docs/security/ge04-b1a-source-authority-review-matrix.md')).hexdigest(),'scanner_provenance':'tmp/ge04-a03-independent-review/opencode-session.log; final 63-line script and output','scanner_method':'Exact preserved keyword list and source-line comment filters; compare non-inventoried line numbers against historical matrix','scanner_keywords':KW,'files':18,'omitted_line_identities':63,'per_file_counts':per,'historical_source_hashes':{f:sha[f] for f in per},'entries':rows,'identity_reconciliation':'RECONSTRUCTED_EXACTLY_63_OF_63_FROM_ORIGINAL_REVIEWER_SCANNER','limitations':['Original reviewer scanner is lexical; its 63 lines are not necessarily 63 distinct authority operations','Includes some docstrings and references due to original scanner filtering','Historical source lines are not current source line numbers','A03-02 semantic completeness and A03-03 site-level security dispositions remain independent requirements'],'security_hold':'ACTIVE'}
out=DOC/'ge04-a03-original-63-identities.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'Exact historical 63 identity drift'
print('A03-01 exact historical identities:',len(rows),'/',sum(counts.values()),'in',len(per),'files; per-file counts match reviewer')
