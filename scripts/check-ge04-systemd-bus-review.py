#!/usr/bin/env python3
"""M2.7 systemd/D-Bus authority source review, not human security approval."""
import json
from pathlib import Path
import sys
root=Path(__file__).resolve().parents[1]
queue=json.loads((root/'docs/security/ge04-b1a-c-authority-review-queue.json').read_text())['entries']
sites=[e for e in queue if any(c['category']=='bus_authority' for c in e['security_checks'])]
assert len(sites)==3
checks={
 'native/ge04/protected-systemd-transaction.c':['SD_BUS_CREDS_UNIQUE_NAME | SD_BUS_CREDS_EUID','uid != (uid_t)0','sd_bus_match_signal(bus, &slot, tx->owner','"JobRemoved"','"Subscribe"','"Unsubscribe"','reply_cookie != tx->request_cookie','strcmp(sd_bus_message_get_sender(reply), tx->owner)','return deny(EPERM); /* SECURITY HOLD: no StartTransientUnit */'],
 'native/ge04/protected-dispatch-preparation.c':['sd_bus_message_new_method_call(','"StartTransientUnit"','expected_headers(message, tx)','return refuse(tx); /* SECURITY HOLD: no sd_bus_send or method call. */'],
 'native/ge04/protected-systemd-request.c':['GE04_PREBIRTH_UNIT','"fail"','GE04_KEEPER_CANDIDATE'],
 'native/ge04/systemd_job_signal_observer.py':['bus.add_signal_receiver(','manager.Subscribe(timeout=1)','manager.Unsubscribe(timeout=1)','bus.get_name_owner(SERVICE)','bus.get_unix_user(owner)','follow_name_owner_changes=False','window.quarantine()','"UNQUALIFIED_LIVE_SYSTEMD_JOB_SIGNAL"']}
paths=[]
for file,needles in checks.items():
 lines=(root/file).read_text().splitlines();anchors=[]
 for needle in needles:
  found=[i+1 for i,line in enumerate(lines) if needle in line]
  assert found,(file,needle)
  anchors.append({'fragment':needle,'lines':found})
 paths.append({'file':file,'anchors':anchors,'human_verdict':'PENDING_INDEPENDENT_HUMAN_REVIEW'})
report={'scope':'MEDIUM-2 M2.7 SYSTEMD AND DBUS AUTHORITY',
 'c_authority_sites':[{k:e[k] for k in ('file','line','apis','source')} for e in sites],
 'source_paths':paths,
 'observed':['C transaction pins unique root-owned manager identity on a private system bus and matches JobRemoved before Subscribe','C job reply validates sender, message type, bus, cookie, signature and canonical job path','C StartTransientUnit preparation is distinct from dispatch; both dispatch entrypoints deny under security hold','Python observer checks manager owner and root identity around bounded signal window, marks result unqualified'],
 'unresolved':['Subscribe/Unsubscribe are real D-Bus method calls and may have side effects despite the StartTransientUnit hold','Unsubscribe failure is swallowed in Python observer; effect on returned unqualified observation needs independent semantics review','C transaction close issues best-effort synchronous Unsubscribe with no explicit separate deadline or outcome proof','Unique-name owner continuity and signal/reply ordering need adversarial manager-restart and forged-signal tests','No privileged live D-Bus test or independent proof that every dispatch path remains unreachable','Python observer signal window is not bound to an exclusive StartTransientUnit request and cannot prove birth'],
 'decision':'AUTHOR_SOURCE_REVIEW_ONLY; NO_BIRTH_AUTHORITY_OR_SECURITY_ACCEPTANCE',
 'independent_verdict':'PENDING_INDEPENDENT_HUMAN_REVIEW'}
out=root/'docs/security/ge04-b1a-systemd-bus-review.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'Systemd bus review drift'
print(f'GE-04 M2.7: {len(sites)} C authority sites and {len(paths)} source paths pinned; independent verdict pending')
