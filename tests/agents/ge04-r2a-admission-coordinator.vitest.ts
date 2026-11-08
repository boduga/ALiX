import type {LaunchIntent,RecoveryRecord} from "../../src/agents/worker-supervisor-recovery-ledger.js";
import {expect,test,vi} from 'vitest';
import {createSerializedAdmissionCoordinator} from '../../src/agents/worker-supervisor-admission-coordinator.js';
const identity={coordinationRunId:'run',workerId:'worker',attempt:1};
const request={identity,configurationId:'config',workspaceRoot:'/tmp'};
const handle={evidence:{identity,pid:321,uid:20001,startTimeTicks:'123',registrationId:'native'},cancel:vi.fn(async()=>{}),wait:vi.fn(async()=>({exitCode:0,signal:null}))};
function fixture(){
 const intents:LaunchIntent[]=[];
 const records:RecoveryRecord[]=[];
 const events:string[]=[];
 const native={launch:vi.fn(async()=>{events.push('spawn');return handle}),reconcile:vi.fn(async()=>{events.push('reconcile')}),revoke:vi.fn(async()=>{})};
 const ledger={unresolved:()=>records,unresolvedIntents:()=>intents,
  beginLaunch:vi.fn((i:LaunchIntent)=>{events.push('intent');intents.push(i)}),
  promoteLaunch:vi.fn((r:RecoveryRecord)=>{events.push('promote');intents.length=0;records.push(r)})};
 return {intents,records,events,native,ledger,coordinator:createSerializedAdmissionCoordinator(native,ledger)};
}
test('no launch before reconciliation; intent precedes spawn; second launch denied',async()=>{
 const f=fixture();
 await expect(f.coordinator.launch(request)).rejects.toThrow(/not reconciled/);
 await f.coordinator.reconcile();
 expect(await f.coordinator.launch(request)).toBe(handle);
 expect(f.events).toEqual(['reconcile','intent','spawn','promote']);
 await expect(f.coordinator.launch(request)).rejects.toThrow(/not reconciled/);
 expect(f.native.launch).toHaveBeenCalledOnce();
 await expect(f.coordinator.reconcile()).rejects.toThrow(/unresolved durable/);
});
test('concurrent launches serialize and only one reaches native spawn',async()=>{
 const f=fixture();await f.coordinator.reconcile();
 const results=await Promise.allSettled([f.coordinator.launch(request),f.coordinator.launch(request)]);
 expect(results.map(x=>x.status)).toEqual(['fulfilled','rejected']);
 expect(f.native.launch).toHaveBeenCalledOnce();
});
test('unknown native spawn leaves intent blocking restart',async()=>{
 const f=fixture();f.native.launch.mockRejectedValueOnce(new Error('unknown spawn'));
 await f.coordinator.reconcile();
 await expect(f.coordinator.launch(request)).rejects.toThrow('unknown spawn');
 expect(f.intents).toHaveLength(1);
 await expect(f.coordinator.reconcile()).rejects.toThrow(/unresolved durable/);
});
test('reconcile cannot race with in-flight launch',async()=>{
 const f=fixture();await f.coordinator.reconcile();
 let release!:()=>void;
 const hold=new Promise<void>(resolve=>{release=resolve});
 f.native.launch.mockImplementationOnce(async()=>{await hold;return handle});
 const launched=f.coordinator.launch(request);
 const checking=f.coordinator.reconcile();
 release();
 await launched;
 await expect(checking).rejects.toThrow(/unresolved durable/);
});
test('revocation cannot silently reauthorize a new launch',async()=>{
 const f=fixture();await f.coordinator.reconcile();
 await f.coordinator.revoke(identity);
 await expect(f.coordinator.launch(request)).rejects.toThrow(/not reconciled/);
 expect(f.native.launch).not.toHaveBeenCalled();
});
