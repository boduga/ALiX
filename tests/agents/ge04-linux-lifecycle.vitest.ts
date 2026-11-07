import {test,expect} from 'vitest';
import {createSupervisorLinuxWorkerLifecycle} from '../../src/agents/worker-supervisor-linux-lifecycle.js';
const identity={pid:45100,uid:10002,coordinationRunId:'coord-a',workerId:'worker-a',attempt:2};
const processIdentity={pid:45100,uid:10002,startTimeTicks:'777'};
const peer={pid:45100,uid:10002,transport:'unix-peer-credentials' as const};
test.skipIf(process.platform!=='linux')('registers and revokes actual supervisor lifecycle',async()=>{
 const lifecycle=createSupervisorLinuxWorkerLifecycle(async()=>processIdentity);
 await lifecycle.onSpawned(identity);
 await expect(lifecycle.resolveAttestedPeer(peer)).resolves.toEqual({coordinationRunId:'coord-a',workerId:'worker-a',attempt:2});
 lifecycle.onExited(identity.pid);
 await expect(lifecycle.resolveAttestedPeer(peer)).rejects.toThrow();
});
test.skipIf(process.platform!=='linux')('rejects UID mismatch and duplicate PID',async()=>{
 const lifecycle=createSupervisorLinuxWorkerLifecycle(async()=>processIdentity);
 await expect(lifecycle.onSpawned({...identity,uid:10003})).rejects.toThrow();
 await lifecycle.onSpawned(identity);
 await expect(lifecycle.onSpawned(identity)).rejects.toThrow(/duplicate/);
 lifecycle.onExited(identity.pid);
});
test.skipIf(process.platform!=='linux')('rejects exit during asynchronous procfs registration',async()=>{
 let release!:()=>void;
 const wait=new Promise<void>(r=>{release=r});
 const lifecycle=createSupervisorLinuxWorkerLifecycle(async()=>{await wait;return processIdentity});
 const registration=lifecycle.onSpawned(identity);
 lifecycle.onExited(identity.pid);
 release();
 await expect(registration).rejects.toThrow(/exited/);
 await expect(lifecycle.resolveAttestedPeer(peer)).rejects.toThrow();
});
test.skipIf(process.platform!=='linux')('rejects changed process starttime (PID reuse)',async()=>{
 let current=processIdentity;
 const lifecycle=createSupervisorLinuxWorkerLifecycle(async()=>current);
 await lifecycle.onSpawned(identity);
 current={...processIdentity,startTimeTicks:'778'};
 await expect(lifecycle.resolveAttestedPeer(peer)).rejects.toThrow();
 lifecycle.onExited(identity.pid);
});

test.skipIf(process.platform!=='linux')('does not reuse PID while old registration is pending',async()=>{
 let release!:()=>void;
 const wait=new Promise<void>(r=>{release=r});
 const lifecycle=createSupervisorLinuxWorkerLifecycle(async()=>{await wait;return processIdentity});
 const first=lifecycle.onSpawned(identity);
 lifecycle.onExited(identity.pid);
 await expect(lifecycle.onSpawned(identity)).rejects.toThrow(/duplicate/);
 release();
 await expect(first).rejects.toThrow(/exited/);
 await lifecycle.onSpawned(identity);
 lifecycle.onExited(identity.pid);
});
