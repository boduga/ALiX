#!/usr/bin/env python3
"""Source-pinned AST effect classification of historical Python call lines."""
import ast,collections,hashlib,json,subprocess,sys
from pathlib import Path
if not __debug__:raise SystemExit('GE-04 evidence check refuses optimized Python: assertions are required')
R=Path(__file__).resolve().parents[1];B=R/'native/ge04';D=R/'docs/security';REV='f748ea2e3030bec9d1e3fa375374663721e7496a'
h=json.loads((D/'ge04-a03-02-historical-kind.json').read_text());entries=[e for e in h['entries'] if e['syntax_kind']=='PYTHON_CALL_EXPRESSION'];assert len(entries)==10
categories={'os.pread':'DESCRIPTOR_READ','hasattr':'CAPABILITY_QUERY','os.memfd_create':'DESCRIPTOR_CREATION','subprocess.Popen':'PROCESS_SPAWN','bus.add_signal_receiver':'DBUS_SIGNAL_SUBSCRIPTION','manager.Subscribe':'DBUS_METHOD_CALL','manager.Unsubscribe':'DBUS_METHOD_CALL','_mount':'LOCAL_PARSER_CALL','_read_fixed':'FILESYSTEM_READ'}
rows=[];counts=collections.Counter()
for e in entries:
 f=e['file'];raw=(B/f).read_bytes();assert raw==subprocess.run(['git','show',f'{REV}:native/ge04/{f}'],cwd=R,check=True,capture_output=True).stdout
 tree=ast.parse(raw);line=e['current_line'];assert raw.decode().splitlines()[line-1].strip()==e['source']
 nodes=[n for n in ast.walk(tree) if isinstance(n,ast.Call) and n.lineno<=line<=n.end_lineno]
 calls=sorted({ast.unparse(n.func) for n in nodes});assert calls,(f,line)
 unknown=[n for n in calls if n not in categories];assert not unknown,(f,line,unknown)
 kinds=sorted({categories[n] for n in calls});counts.update(kinds)
 rows.append({'file':f,'line':line,'source':e['source'],'ast_call_names_spanning_line':calls,'effect_hypotheses':kinds,'source_sha256':hashlib.sha256(raw).hexdigest(),'callee_runtime_identity_verified':False,'authorization_verified':False,'security_verdict':'PENDING'})
assert len(rows)==10
report={'scope':'A03-02 historical Python calls with source-pinned AST callee classification','reviewed_revision':REV,'entries':rows,'classified_historical_call_lines':10,'effect_hypothesis_counts':dict(sorted(counts.items())),'security_approvals':0,'limitations':['AST callee names are syntactic, not proven runtime identities','Nested and multiline calls are included when spanning the source line','No authorization, descriptor/process lifetime, DBus identity or runtime effects proven'],'security_hold':'ACTIVE'}
out=D/'ge04-a03-02-historical-python-calls.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'Historical Python call classification drift'
print('Historical Python call lines:',len(rows),'effect hypotheses:',dict(counts),'security approvals 0')
