#!/usr/bin/env python3
"""M2.8: preserve original reviewer omission claims without inventing missing identities."""
import json,re,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
review=root/'tmp/ge04-a03-independent-review/opencode-findings.md'
source=review.read_text()
section=source.split('### MEDIUM-2 —',1)[1].split('### MEDIUM-3 —',1)[0]
assert '63 non-comment' in section and '18 files' in section
counts={'cgroup-worker-qualification.c':15,'cgroup-runtime-view-qualification.c':13,'isolated-worker-launcher.c':4,'protected-cgroup-custody.c':4,'worker-stream.c':4,'systemd_job_signal_observer.py':3,'unit_kernel_observer.py':3,'bootstrap_publisher.py':2,'bootstrap_receiver.py':2,'pidfd-lifecycle-qualification.c':2,'protected-attempt-fence.c':2,'protected-dispatch-intent.c':2,'protected-prebirth-journal.c':2,'bootstrap_binding.py':1,'bounded_job_signal_observer.py':1,'bounded_phase_observer.py':1,'broker-peer-probe.c':1,'cgroup-leaf-ownership-qualification.c':1}
assert len(counts)==18 and sum(counts.values())==63
for name,count in counts.items():
 assert f'`{name}`' in section,(name,'reviewer source absent')
 # Each historical reviewer count must be present in the prose (not a machine-readable omitted-line list).
triage=json.loads((root/'docs/security/ge04-b1a-broad-omission-triage.json').read_text())['entries']
byfile={name:[] for name in counts}
for e in triage:
 if e['file'] in byfile:byfile[e['file']].append(e)
assert sum(map(len,byfile.values()))==220
examples=[]
for line in section.splitlines():
 if not line.startswith('| `'):continue
 cols=[x.strip() for x in line.strip('|').split('|')]
 if len(cols)<4:continue
 match=re.fullmatch(r'`([^`]+)`',cols[0]);
 if not match or match.group(1) not in counts:continue
 examples.append({'file':match.group(1),'reviewer_historical_line_text':cols[1], 'reviewer_operation_text':cols[2], 'reviewer_rationale':cols[3], 'identity_status':'REVIEWER_EXPLICIT_EXAMPLE_NOT_COMPLETE_63_LIST'})
assert len(examples)>=17,len(examples)
report={'scope':'MEDIUM-2 M2.8 HISTORICAL 63 OMISSIONS',
 'reviewer_source':'tmp/ge04-a03-independent-review/opencode-findings.md MEDIUM-2',
 'historical_revision':'d6e22669',
 'reviewer_reported_omissions':63,'reviewer_reported_files':18,
 'explicit_example_rows':examples,
 'per_file':[{'file':name,'reviewer_reported_omitted_lines':count,
 'independent_broad_scan_candidates':len(byfile[name]),
 'candidate_line_numbers':[e['line'] for e in byfile[name]],
 'exact_omitted_line_identities':'NOT_PUBLISHED_BY_REVIEWER',
 'identity_level_reconciliation':'BLOCKED_OR_REQUIRES_INDEPENDENT_REPLACEMENT_AUDIT'} for name,count in counts.items()],
 'limitations':['The reviewer published counts and selected examples, not its 63-line identity set or keyword scanner.','220 historical broad-scan candidates in the cited 18 files are not equivalent to the original 63.','Do not infer omitted-line identity from matching per-file counts, current line numbers, or lexical candidates.','Full reconciliation requires reviewer source list/scanner or independently approved equivalent semantic audit.'],
 'independent_human_verdict':'PENDING_INDEPENDENT_HUMAN_REVIEW',
 'security_hold':'ACTIVE'}
out=root/'docs/security/ge04-b1a-original-63-reconciliation.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'Original 63 reconciliation drift'
print(f'M2.8: {len(counts)} reviewer files, {sum(counts.values())} reported omissions, {len(examples)} explicit example rows, {sum(map(len,byfile.values()))} independent candidates; exact identity set unavailable')
