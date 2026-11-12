#!/usr/bin/env python3
"""Pin author control-flow observations and unresolved risks for 14 destructive sites."""
import json
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[1]
SRC=ROOT/'docs/security/ge04-b1a-c-authority-review-queue.json'
OUT=ROOT/'docs/security/ge04-b1a-destructive-site-review.json'
# Human-readable operation/guard notes are explicitly author assertions, not independent findings.
NOTES={
 ('cgroup-leaf-ownership-qualification.c',58):('leaf creation','strict-mode parent validation, EEXIST refusal','non-strict arbitrary parent; fixture-only routing must be independently confirmed'),
 ('cgroup-runtime-view-qualification.c',405):('namespace mount propagation','child bootstrap; error terminates _exit(121)','namespace isolation and mount capability require privileged independent gate'),
 ('cgroup-runtime-view-qualification.c',407):('cgroup2 mount','child bootstrap; error terminates _exit(123)','namespace target and mount propagation require privileged independent gate'),
 ('cgroup-runtime-view-qualification.c',531):('inner directory removal','inner_custody, controllers, known_children, empty, bindings, budget','named entry may be replaced after fd/name identity check'),
 ('cgroup-runtime-view-qualification.c',538):('journal removal','intent canonical parse, records_equal, budget','record can be replaced between parse and unlink unless writer exclusion is established'),
 ('cgroup-runtime-view-qualification.c',585):('outer directory removal','owned outer, bindings, child cleanup, empty, deadline','name replacement and partial cleanup/replay require review'),
 ('cgroup-runtime-view-qualification.c',675):('unpublished temp removal','absence of named outer, pending intent equality, bindings','name/record check-to-unlink race; crash replay'),
 ('cgroup-runtime-view-qualification.c',724):('outer directory creation','setup approval, pinned parent and budget, exclusive mkdirat','birth-to-journal crash consistency and parent write exclusion'),
 ('cgroup-runtime-view-qualification.c',730):('inner directory creation','outer custody and budget, exclusive mkdirat','partial inner creation cleanup and crash replay'),
 ('cgroup-worker-qualification.c',331):('journal artifact removal','read_intent and records_equal before unlinkat','journal name replacement after record read'),
 ('cgroup-worker-qualification.c',353):('worker leaf removal','owned_leaf, bindings, kill/empty/reap, final bindings and empty','name replacement after final identity check'),
 ('cgroup-worker-qualification.c',428):('sweep worker leaf removal','unpublished intent and inode binding, reopen, empty, bindings','readdir/reopen/unlink identity race; quarantine on mismatch'),
 ('cgroup-worker-qualification.c',438):('unpublished temp removal','temp canonical parse, invocation and parent match, no named leaf','temp record replacement between read and unlink'),
 ('cgroup-worker-qualification.c',469):('worker leaf creation','setup approval, pinned parent and work lock, exclusive mkdirat','birth-to-intent crash replay and unauthorized parent writers'),
}
items=[e for e in json.loads(SRC.read_text())['entries'] if any(c['category']=='destructive_mutation' for c in e['security_checks'])]
assert len(items)==14 and {(e['file'],e['line']) for e in items}==set(NOTES),'Destructive review coverage drift'
entries=[]
for e in items:
 operation,guards,open_risk=NOTES[(e['file'],e['line'])]
 entries.append({'file':e['file'],'line':e['line'],'source':e['source'],'operation':operation,
  'author_observed_guards':guards,'unresolved_risk':open_risk,
  'independent_reviewer_verdict':'PENDING_INDEPENDENT_HUMAN_REVIEW'})
report={'method':'AUTHOR_SOURCE_CONTROL_FLOW_OBSERVATIONS_NOT_SECURITY_ACCEPTANCE',
 'entries':entries,'limitations':'Observed guards are not proof of writer exclusion, branch reachability, race freedom, privileged runtime behavior, or historical 63-line closure.'}
if '--write' in sys.argv:OUT.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(OUT.read_text())==report,'Destructive site review drift'
print('GE-04 destructive site review: 14/14 source-grounded author observations; 14 pending independent verdicts')
