#!/usr/bin/env python3
"""Prioritize previously unlisted API names without clearing any security sites.

Rule categories are triage hypotheses, not proof of harmlessness. Every name
retains a pending semantic disposition and a link to its source unit.
"""
import json,re,sys
from collections import Counter
from pathlib import Path
D=Path(__file__).resolve().parents[1]/'docs/security'
def read(n):return json.loads((D/n).read_text())
v=read('ge04-a03-02-api-vocabulary-gap.json');g=read('ge04-a03-02-gcc-callsite-provenance.json')
byfile={r['file']:r for r in g['entries']}
# Explicit risk-first vocabulary, deliberately broader than the draft allowlist.
RISK={
 'PRIVILEGE_OR_PROCESS':r'^(?:set(?:res|re|e)?(?:uid|gid)|setgroups|unshare|setns|clone3?|fork|vfork|exec\w*|prctl|cap\w*|kill|tgkill|wait\w*|pidfd\w*|setsid|setpgid|syscall|_exit|exit)$',
 'FILESYSTEM_MUTATION':r'^(?:unlink\w*|rename\w*|remove\w*|mkdir\w*|rmdir|chmod|fchmod\w*|chown|fchown\w*|mount|umount\w*|open\w*|creat|write\w*|pwrite\w*|truncate|ftruncate|fsync|fdatasync|link\w*|symlink\w*|dup\w*|close|fcntl|flock)$',
 'DESCRIPTOR_OR_NETWORK':r'^(?:send\w*|recv\w*|accept\w*|socket\w*|bind|listen|connect|getsockopt|setsockopt|ioctl|read\w*|pread\w*|poll|select|epoll\w*)$',
 'SYSTEMD_BUS_OR_AUTHORIZATION':r'^(?:sd_bus_\w+|dbus_\w+|ge04_\w*(?:approval|recheck|authorize|policy|transaction)\w*|approval|authorize|policy\w*|deny|refuse|fail|check)$',
}
patterns={k:re.compile(p) for k,p in RISK.items()}
rows=[];counts=Counter()
for unit in v['c_rows']:
 name=unit['file'];source=byfile[name]['gimple_call_candidates']
 for symbol in unit['compiler_names_not_in_draft']:
  categories=[kind for kind,pattern in patterns.items() if pattern.fullmatch(symbol)]
  if not categories:categories=['UNKNOWN_EFFECT_OR_LOCAL_WRAPPER']
  locs=sorted({(loc['file'],loc['line']) for s in source if s['target_token']==symbol and not s['gimple_statement'].lstrip().startswith(('//','/*','#')) for loc in s['locations'] if loc['file']==name})
  rows.append({'file':name,'symbol':symbol,'triage_categories':categories,'source_lines':[line for _,line in locs],'semantic_disposition':'PENDING_EFFECT_AND_AUTHORITY_REVIEW','security_verdict':'NOT_ADJUDICATED'})
  for c in categories:counts[c]+=1
assert len(rows)==v['c_total_per_file_unlisted_names']
# Sensitive examples from real source must not silently fall into benign bucket.
for symbol in ['syscall','openat','close','sd_bus_call_method','setresuid','unlinkat']:
 matches=[r for r in rows if r['symbol']==symbol]
 if matches:assert all('UNKNOWN_EFFECT_OR_LOCAL_WRAPPER' not in r['triage_categories'] for r in matches)
report={'scope':'A03-02 risk-prioritized triage of unlisted C call names','reviewed_revision':g['reviewed_revision'],'per_file_unlisted_c_names':len(rows),'category_counts':dict(sorted(counts.items())),'entries':rows,'status':'RISK_PRIORITIZED_NOT_SEMANTICALLY_ADJUDICATED','limitations':['Regex categories are prioritization, not confirmed semantic effects','Unknown/local wrapper bucket is not safe or low risk; transitive effects remain unresolved','Call source lines are GCC provenance and can be macro expansion locations','Python 607 per-file expression gaps remain unresolved','No human site verdict or A03-02 semantic completeness is inferred'],'security_hold':'ACTIVE'}
out=D/'ge04-a03-02-authority-priority.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'A03-02 authority priority drift'
print('A03-02 authority priority:',len(rows),'unlisted C names;',dict(counts),'ALL pending')
