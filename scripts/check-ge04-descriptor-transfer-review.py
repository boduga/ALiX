#!/usr/bin/env python3
"""M2.5 source-grounded descriptor transfer review; no security acceptance."""
import json
from pathlib import Path
import sys
root=Path(__file__).resolve().parents[1]
queue=json.loads((root/'docs/security/ge04-b1a-c-authority-review-queue.json').read_text())['entries']
sites=[e for e in queue if any(c['category']=='descriptor_transfer' for c in e['security_checks'])]
assert len(sites)==4
anchors={
 'native/ge04/worker-stream.c':[
 'SO_PEERCRED','SO_PASSCRED','MSG_TRUNC|MSG_CTRUNC','SCM_RIGHTS','SCM_PIDFD','close(fd)',
 'MSG_CMSG_CLOEXEC|MSG_DONTWAIT','credentials==1','cred.pid!=s->peer.pid'],
 'native/ge04/bootstrap_receiver.py':[
 'socket.SO_PEERCRED','inspect_generation(pid)','socket.MSG_CMSG_CLOEXEC',
 'socket.SCM_RIGHTS','socket.MSG_CTRUNC | socket.MSG_TRUNC','len(ancillary) != 1',
 'len(received) != 1','read_sealed_bootstrap_binding(','os.close(fd)'],
 'native/ge04/bootstrap_publisher.py':[
 'os.geteuid() == 0','os.memfd_create(','os.MFD_CLOEXEC | os.MFD_ALLOW_SEALING',
 'fcntl.F_ADD_SEALS','fcntl.F_GET_SEALS','os.close(fd)',
 'raise PermissionError("GE-04 SECURITY HOLD: root publisher unimplemented")'],
 'native/ge04/broker-peer-probe.c':['accept4(','SO_PEERCRED','cred.pid > 0','cred.uid == allowed']}
entries=[]
for path,fragments in anchors.items():
 lines=(root/path).read_text().splitlines();items=[]
 for fragment in fragments:
  positions=[i+1 for i,line in enumerate(lines) if fragment in line]
  assert positions,(path,fragment)
  items.append({'fragment':fragment,'lines':positions})
 entries.append({'file':path,'source_anchors':items,'human_verdict':'PENDING_INDEPENDENT_HUMAN_REVIEW'})
report={'scope':'MEDIUM-2 M2.5 DESCRIPTOR TRANSFER AND PEER AUTHORITY',
 'c_authority_sites':[{k:e[k] for k in ('file','line','apis','source')} for e in sites],
 'source_paths':entries,
 'observations':['C stream rejects descriptor-bearing ancillary messages and closes SCM_RIGHTS/SCM_PIDFD fds','C stream validates kernel peer credentials and one SCM_CREDENTIALS record','Python bootstrap receiver closes all decoded SCM_RIGHTS descriptors in finally, including rejected messages','Python bootstrap receiver validates peer credentials, generation, sealed binding and nonce/attempt','Unprivileged fixture memfd is sealed and privileged publisher is disabled'],
 'unresolved':['C ancillary parser handling of malformed/truncated control structures and kernel auto-closed excess descriptors requires adversarial testing','Python ancillary parsing closes complete int-sized SCM_RIGHTS entries; malformed remainder and truncation require kernel-level validation','Peer credential and process-generation observations are not atomic; verify pidfd/generation binding through transfer','SO_PEERCRED on stream/seqpacket and SCM_CREDENTIALS per-message semantics require independent review','Descriptor lifetime, leak prevention, and error branches require syscall-level fault injection','Broker peer probe is an isolated fixture, not protected broker authorization'],
 'decision':'AUTHOR_SOURCE_REVIEW_ONLY_NO_PRIVILEGED_TRANSFER_OR_SECURITY_ACCEPTANCE',
 'independent_verdict':'PENDING_INDEPENDENT_HUMAN_REVIEW'}
out=root/'docs/security/ge04-b1a-descriptor-transfer-review.json'
if '--write' in sys.argv:out.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(out.read_text())==report,'Descriptor transfer review drift'
print(f'GE-04 M2.5: {len(sites)} C authority sites, {len(entries)} source paths pinned; independent verdict pending')
