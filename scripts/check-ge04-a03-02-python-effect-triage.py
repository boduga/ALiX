#!/usr/bin/env python3
"""Risk-first triage of all Python API vocabulary gaps, preserving ambiguity.

AST-backed call identity, not a runtime call graph or site security verdict.
"""
import ast,hashlib,json,re,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];BASE=ROOT/'native/ge04';D=ROOT/'docs/security'
REV='f748ea2e3030bec9d1e3fa375374663721e7496a'
def read(n):return json.loads((D/n).read_text())
v=read('ge04-a03-02-api-vocabulary-gap.json');aliases=read('ge04-a03-02-python-aliases.json')
by_alias={r['file']:{(x['line'],x['column']):x for x in r['calls']} for r in aliases['entries']}
by_gap={r['file']:set(r['call_expressions_not_in_draft']) for r in v['python_rows']}
RISK={
 'PRIVILEGE_PROCESS_EXECUTION':r'(?:^|\.)(?:set(?:res|re|e)?(?:uid|gid)|setgroups|fork|exec\w*|spawn\w*|kill|terminate|wait|poll|pidfd\w*|Popen|run|check_call|check_output|system|prctl|unshare|setns)$',
 'FILESYSTEM_DESCRIPTOR_EFFECT':r'(?:^|\.)(?:open|close|read|write|pread|pwrite|unlink|remove|rmdir|mkdir|rename|replace|chmod|chown|fchmod|fchown|fstat|stat|lstat|fsync|fdatasync|dup|dup2|memfd_create|sendmsg|recvmsg|socket|connect|accept|register|unregister|set_blocking|fileno)$',
 'DBUS_SYSTEMD_AUTHORITY':r'(?:^|\.)(?:Subscribe|Unsubscribe|add_signal_receiver|remove_signal_receiver|get_name_owner|get_unix_user|get_object|BusConnection|Interface|StartTransientUnit|StopUnit|KillUnit|GetUnit|Get|Set|call_blocking)$',
 'DYNAMIC_DISPATCH':r'(?:^|\.)(?:getattr|setattr|delattr|eval|exec|__import__|import_module)$',
}
patterns={k:re.compile(x) for k,x in RISK.items()}
rows=[];files=[]
for p in sorted(BASE.glob('*.py')):
 raw=p.read_bytes();assert raw==subprocess.run(['git','show',f'{REV}:native/ge04/{p.name}'],cwd=ROOT,capture_output=True,check=True).stdout
 tree=ast.parse(raw,filename=p.name);calls=sorted((n for n in ast.walk(tree) if isinstance(n,ast.Call)),key=lambda n:(n.lineno,n.col_offset))
 gaps=by_gap[p.name];file_rows=[];alias=by_alias[p.name]
 for n in calls:
  expr=ast.unparse(n.func)
  if expr not in gaps:continue
  previous=alias[(n.lineno,n.col_offset)];target=previous['resolved_static_target'] or expr
  cats=[name for name,pattern in patterns.items() if pattern.search(target)]
  if not cats:cats=['UNKNOWN_OR_LOCAL_WRAPPER']
  kind='DYNAMIC_CALLEE_EXPRESSION' if isinstance(n.func,(ast.Call,ast.Subscript,ast.Lambda)) else ('RECEIVER_METHOD_UNRESOLVED' if isinstance(n.func,ast.Attribute) and not previous['resolved_static_target'] else 'DIRECT_NAME_OR_STATIC_ALIAS_CANDIDATE')
  file_rows.append({'line':n.lineno,'column':n.col_offset,'expression':expr,'resolved_alias_candidate':previous['resolved_static_target'],'call_shape':kind,'triage_categories':cats,'semantic_disposition':'PENDING','security_verdict':'NOT_ADJUDICATED'})
 files.append({'file':p.name,'source_sha256':hashlib.sha256(raw).hexdigest(),'gap_expression_count':len(gaps),'gap_callsite_count':len(file_rows),'entries':file_rows})
 rows.extend(file_rows)
assert len(files)==24
assert all({r['expression'] for r in f['entries']}==by_gap[f['file']] for f in files)
assert sum(len(by_gap[f['file']]) for f in files)==v['python_total_per_file_call_expressions_not_in_draft']==607
from collections import Counter
categories=Counter(c for r in rows for c in r['triage_categories']);shapes=Counter(r['call_shape'] for r in rows)
# Reviewer-sensitive examples must be recognized if present in the gaps.
for name in ('manager.Subscribe','manager.Unsubscribe','bus.add_signal_receiver','os.memfd_create','os.pread','process.kill'):
 matched=[r for r in rows if r['expression']==name]
 if matched:assert all(r['triage_categories']!=['UNKNOWN_OR_LOCAL_WRAPPER'] for r in matched),name
report={'scope':'A03-02 AST-located Python unlisted call expression effect triage','reviewed_revision':REV,'files':len(files),'distinct_gap_expressions_per_file':607,'gap_callsite_occurrences':len(rows),'category_counts':dict(sorted(categories.items())),'call_shape_counts':dict(sorted(shapes.items())),'entries':files,'status':'PYTHON_EFFECT_TRIAGE_PENDING_SEMANTIC_AND_SITE_REVIEW','limitations':['Regex categories prioritize review and are not evidence of a real side effect','Method receiver identity, imported wrappers, decorators and runtime dispatch remain unresolved','Repeated calls to the same expression are distinct sites; 607 is distinct per-file expressions, not calls','Unknown/local wrapper is not a safe classification','No human site verdict, cross-language proof or A03-02 completion inferred'],'security_hold':'ACTIVE'}
out=D/'ge04-a03-02-python-effect-triage.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'Python effect triage drift'
print('A03-02 Python effect triage:',len(files),'files;',len(rows),'call occurrences across 607 per-file expressions;',dict(categories),'ALL PENDING')
