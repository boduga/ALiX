#!/usr/bin/env python3
"""Explicit source-syntax disposition of the 80 current C sensitive lexical sites.

Does not adjudicate authorization, custody, race freedom, or human acceptance.
"""
import json
from pathlib import Path
import re
import sys
from collections import Counter

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'native/ge04'
SOURCE = ROOT / 'docs/security/ge04-b1a-sensitive-site-context.json'
OUTPUT = ROOT / 'docs/security/ge04-b1a-c-sensitive-disposition.json'
# Explicit noncall sites require a source-specific reason and are never silently discarded.
NONCALL = {
 ('cgroup-control-fd-qualification.c',28):'local fd variable named kill, not kill(2)',
 ('cgroup-control-fd-qualification.c',29):'local fd variable named kill, not kill(2)',
 ('cgroup-control-fd-qualification.c',32):'local fd variable named kill, not kill(2)',
 ('cgroup-control-fd-qualification.c',36):'local fd variable named kill, not kill(2)',
 ('cgroup-control-fd-qualification.c',38):'local fd variable named kill, not kill(2)',
 ('cgroup-control-fd-qualification.c',45):'local fd variable named kill, not kill(2)',
 ('cgroup-control-fd-qualification.c',49):'local fd variable named kill, not kill(2)',
 ('cgroup-control-fd-qualification.c',52):'local fd variable named kill, not kill(2)',
 ('cgroup-dirfd-qualification.c',77):'string literal cgroup.kill, not kill(2)',
 ('cgroup-runtime-view-qualification.c',230):'string literal cgroup.kill, not kill(2)',
 ('cgroup-runtime-view-qualification.c',406):'mode string fail-mount, not mount(2)',
 ('cgroup-runtime-view-qualification.c',621):'string literal cgroup.kill, not kill(2)',
 ('cgroup-runtime-view-qualification.c',690):'mode string fail-mount, not mount(2)',
 ('cgroup-runtime-view-qualification.c',743):'mode string fail-mount, not mount(2)',
 ('cgroup-worker-qualification.c',157):'string literal cgroup.kill, not kill(2)',
 ('cgroup-worker-qualification.c',177):'string literal cgroup.kill, not kill(2)',
 ('isolated-worker-launcher.c',78):'diagnostic string openat2 unavailable, not openat2 invocation',
 ('isolated-worker-launcher.c',131):'diagnostic string execveat unavailable, not execveat invocation',
 ('exec-pinned-probe.c',15):'diagnostic string execveat, not execveat invocation',
 ('exec-pinned.c',14):'diagnostic string execveat, not execveat invocation',
 ('pidfd-lifecycle-qualification.c',36):'diagnostic string fork on error branch, not a fork call',
 ('pidfd-lifecycle-qualification.c',49):'diagnostic string kill; call is send_pinned',
 ('pidfd-qualification.c',24):'CLI mode string kill, not kill(2)',
 ('pidfd-qualification.c',35):'CLI mode string kill, not kill(2)',
 ('pidfd-qualification.c',38):'diagnostic string pidfd_send_signal; actual invocation is syscall(SYS_pidfd_send_signal)',
 ('protected-cgroup-custody.c',181):'comment describing mount provenance, not mount(2)',
 ('protected-dispatch-intent.c',130):'D-Bus method string comparison, not dispatch',
 ('protected-dispatch-preparation.c',46):'D-Bus method string comparison, not dispatch',
 ('protected-dispatch-preparation.c',67):'D-Bus method string literal argument; dispatch must be reviewed at callee',
 ('protected-mount-namespace.c',187):'comment describing mount namespace, not mount(2)',
 ('protected-systemd-transaction.c',83):'D-Bus member string Unsubscribe; authority-bearing method request',
 ('protected-systemd-transaction.c',283):'D-Bus member string Subscribe; authority-bearing method request',
 ('protected-systemd-transaction.c',306):'fail-closed refusal of StartTransientUnit, not a dispatch',
}
# The three D-Bus request sites are authority-bearing despite not being C function calls.
AUTHORITY_NONCALL = {
 ('protected-dispatch-preparation.c',67),
 ('protected-systemd-transaction.c',83),
 ('protected-systemd-transaction.c',283),
 ('worker-stream.c',189),
 ('cgroup-runtime-view-qualification.c',443),
 ('cgroup-worker-qualification.c',480),
}
entries=[]
for site in json.loads(SOURCE.read_text())['entries']:
    if not site['file'].endswith('.c'):
        continue
    key=(site['file'],site['line'])
    line=(BASE/site['file']).read_text().splitlines()[site['line']-1]
    assert line.strip()==site['source']
    direct=sorted(api for api in site['apis'] if re.search(r'(?<![A-Za-z0-9_])'+re.escape(api)+r'\s*\(',line))
    if key in AUTHORITY_NONCALL:
        kind='AUTHORITY_RELEVANT_NONCALL_OR_SYSCALL_FLAG'
        reason='Method/ancillary/clone flag participates in authority-bearing operation; inspect enclosing call and custody.'
    elif key in NONCALL:
        kind='NONCALL_LEXICAL_REFERENCE'
        reason=NONCALL[key]
    elif direct:
        kind='DIRECT_C_CALL_SYNTAX'
        reason='Source shows direct API call syntax; review preconditions, authorization, error and cleanup.'
    elif 'SYS_clone3' in site['apis']:
        kind='SYSCALL_NUMBER_DISPATCH'
        reason='syscall(SYS_clone3, ...) dispatch; review clone flags, cgroup binding and failure.'
    elif 'CLONE_INTO_CGROUP' in site['apis']:
        kind='AUTHORITY_RELEVANT_NONCALL_OR_SYSCALL_FLAG'
        reason='Clone flag participates in cgroup-targeted process birth.'
    elif 'SCM_RIGHTS' in site['apis']:
        kind='AUTHORITY_RELEVANT_NONCALL_OR_SYSCALL_FLAG'
        reason='Ancillary descriptor-transfer constant; not a function call.'
    elif 'SYS_pidfd_send_signal' in line:
        kind='SYSCALL_NUMBER_DISPATCH'
        reason='syscall-number dispatch; review signal target and custody.'
    else:
        kind='UNRESOLVED_SOURCE_SYNTAX'
        reason='Needs manual inspection; cannot infer operation from lexical token.'
    entries.append({'file':site['file'],'line':site['line'],'apis':site['apis'],
                    'source':site['source'],'syntax_disposition':kind,'reason':reason,
                    'review_categories':site['review_categories'],
                    'required_checks':site['required_checks'],
                    'security_verdict':'PENDING_INDEPENDENT_HUMAN_REVIEW'})
report={'method':'AUTHOR_C_SOURCE_SYNTAX_TRIAGE_NOT_SEMANTIC_SECURITY_REVIEW',
        'entries':entries,'limitations':'Direct syntax and flags do not establish reachability, authorization, error handling, or race freedom.'}
if '--write' in sys.argv:
    OUTPUT.write_text(json.dumps(report,indent=2)+'\n')
else:
    assert json.loads(OUTPUT.read_text())==report,'C site disposition drift'
print('GE-04 C 80-site classification:',dict(Counter(e['syntax_disposition'] for e in entries)))
if len(entries)!=80 or any(e['syntax_disposition']=='UNRESOLVED_SOURCE_SYNTAX' for e in entries):
    raise SystemExit('Unresolved C source syntax sites remain')
