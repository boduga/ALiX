#!/usr/bin/env python3
"""Source-pinned author review queue for 50 authority-relevant C sites.

No reviewer verdict or authorization proof is inferred from syntax.
"""
import json
from pathlib import Path
import sys
from collections import Counter

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'native/ge04'
INPUT=ROOT/'docs/security/ge04-b1a-c-sensitive-disposition.json'
OUT=ROOT/'docs/security/ge04-b1a-c-authority-review-queue.json'
RISK={
 'destructive_mutation':('Verify fd/record binding immediately before mutation, exclusive custody, name-replacement race, and crash replay.', 'Identity-bound removal or explicit quarantine on mismatch; no unowned deletion.'),
 'privilege_transition':('Verify real/effective/saved IDs, group clearing, no_new_privs, and all failed-transition paths.', 'No exec/fork after partial privilege drop; verify independently in permitted test environment.'),
 'process_lifecycle':('Verify target PID/pidfd generation, cgroup membership, signal/reap error paths and stale process refusal.', 'Only the bound process may be signalled or reaped; failures are terminal or quarantined.'),
 'descriptor_transfer':('Verify peer credential binding, ancillary bounds, fd close on every rejection, and message truncation.', 'Untrusted descriptors cannot gain authority or leak across refusal paths.'),
 'custody_and_locking':('Verify pinned inode/owner/mode, seal/lock semantics, TOCTOU and cleanup of partial state.', 'No untrusted replacement or partial publication may be accepted.'),
 'bus_authority':('Verify trusted bus owner and unit/job identity, method allowlist, response provenance and refusal behavior.', 'No unreviewed manager mutation, and StartTransientUnit remains refused.'),
}
entries=[]
for site in json.loads(INPUT.read_text())['entries']:
 if site['syntax_disposition']=='NONCALL_LEXICAL_REFERENCE':continue
 categories=site['review_categories']
 checks=[{'category':c,'review_question':RISK[c][0],'required_invariant':RISK[c][1]} for c in categories]
 lines=(BASE/site['file']).read_text().splitlines()
 assert lines[site['line']-1].strip()==site['source']
 entries.append({'file':site['file'],'line':site['line'],'apis':site['apis'],
  'source':site['source'],'syntax_disposition':site['syntax_disposition'],
  'security_checks':checks,'source_context':lines[max(0,site['line']-5):min(len(lines),site['line']+4)],
  'author_finding':'REQUIRES_CONTROL_FLOW_AND_NEGATIVE_PATH_REVIEW',
  'reviewer_verdict':'PENDING_INDEPENDENT_HUMAN_REVIEW'})
report={'method':'AUTHOR_AUTHORITY_REVIEW_QUEUE_NOT_SECURITY_ACCEPTANCE','entries':entries,
 'limitations':'Review questions are not control-flow proofs. Existing 12-group destructive review is partial; no runtime privileged validation, indirect-call closure, or historical 63-line reconciliation.'}
if '--write' in sys.argv:OUT.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(OUT.read_text())==report,'C authority queue drift'
assert len(entries)==50
print('GE-04 C authority review queue: 50 sites;',dict(Counter(c['category'] for e in entries for c in e['security_checks'])))
