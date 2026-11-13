#!/usr/bin/env python3
"""M2.4 pinned process-lifecycle source review; not runtime security approval."""
import json
from pathlib import Path
import sys
root=Path(__file__).resolve().parents[1]
queue=json.loads((root/'docs/security/ge04-b1a-c-authority-review-queue.json').read_text())['entries']
sites=[e for e in queue if any(x['category']=='process_lifecycle' for x in e['security_checks'])]
assert len(sites)==17
checks={
 'cgroup-worker-qualification.c':{
  'clone_pidfd':'CLONE_INTO_CGROUP|CLONE_PIDFD',
  'generation_readback':'after!=expected_ticks',
  'stopped_gate':'state!=\'T\'',
  'resume_by_pidfd':'SYS_pidfd_send_signal,c.pidfd,SIGCONT',
  'cgroup_kill':'write(c->killfd,"1",1)',
  'reap':'waitpid(-1,&status,WNOHANG)'},
 'cgroup-runtime-view-qualification.c':{
  'clone_pidfd':'CLONE_INTO_CGROUP|CLONE_PIDFD',
  'generation_gate':'ticks!=c->ticks[slot]',
  'membership_gate':'stopped(c,slot,slot==0?c->outer:c->launcher)',
  'resume_by_pidfd':'SYS_pidfd_send_signal,c->pidfd[slot],SIGCONT',
  'cgroup_kill':'write(c->killfd,"1",1)',
  'reap':'waitpid(-1,&status,WNOHANG)'},
 'pidfd-lifecycle-qualification.c':{
  'owned_child':'pid_t child=fork()',
  'pidfd_open':'SYS_pidfd_open,child,0',
  'signal_by_pidfd':'SYS_pidfd_send_signal,fd,signal_number',
  'owned_pid_fallback':'kill(child,SIGKILL)',
  'reap':'waitpid(child,&status,0)',
  'poll_liveness':'return result==0;'}}
fixtures=[]
for file,needles in checks.items():
 lines=(root/'native/ge04'/file).read_text().splitlines();anchors={}
 for key,needle in needles.items():
  found=[i+1 for i,line in enumerate(lines) if needle in line]
  assert found,(file,key,needle)
  anchors[key]={'fragment':needle,'lines':found}
 fixtures.append({'file':file,'anchors':anchors,'human_verdict':'PENDING_INDEPENDENT_HUMAN_REVIEW'})
report={'scope':'MEDIUM-2 M2.4 PROCESS LIFECYCLE',
 'authority_sites':[{k:e[k] for k in ('file','line','apis','source')} for e in sites],
 'fixtures':fixtures,
 'author_observations':['worker and runtime-view clone3 use CLONE_PIDFD with CLONE_INTO_CGROUP','SIGCONT uses pidfd rather than a reusable numeric PID','stopped-state and cgroup membership readbacks precede resume','cleanup checks empty cgroup and reaps children','standalone pidfd fixture permits kill(PID) fallback only for its directly forked unreaped child'],
 'unresolved':['poll errors and unexpected revents need negative-path adjudication','waitpid(-1) reaping scope and potential unrelated children need isolation proof','process /proc start-time and namespace identity reads are separate from pidfd identity checks','cgroup.kill and failed cleanup need adversarial failure injection','standalone pidfd fallback kill and blocking reap require independent deadlock/ownership analysis','exec-pinned helpers have no pidfd-based admission proof and must remain qualification-only'],
 'decision':'AUTHOR_SOURCE_REVIEW_ONLY_NOT_SECURITY_ACCEPTANCE',
 'human_verdict':'PENDING_INDEPENDENT_HUMAN_REVIEW'}
out=root/'docs/security/ge04-b1a-process-lifecycle-review.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'Process lifecycle review drift'
print(f'GE-04 M2.4: {len(sites)} process authority sites, {len(fixtures)} fixture paths pinned; human verdict pending')
