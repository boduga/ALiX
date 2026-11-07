import {expect,test,vi} from 'vitest';
import {createRecoveryGatedWorkerSupervisor} from '../../src/agents/worker-supervisor-recovery-gate.js';
const request={identity:{coordinationRunId:'r',workerId:'w',attempt:1},configurationId:'c',workspaceRoot:'/usr'};
const unresolved=[{worker:request.identity,process:{pid:12,uid:20002,startTimeTicks:'123'},registrationId:'r1'}];
const fixture=()=>({launch:vi.fn(async()=>({evidence:{...request.identity},cancel:async()=>{},wait:async()=>({exitCode:0,signal:null})})),revoke:vi.fn(async()=>{}),reconcile:vi.fn(async()=>{})});

test('startup gate refuses launch until clean reconciliation',async()=>{
 const supervisor=fixture();let rows=[...unresolved];
 const gate=createRecoveryGatedWorkerSupervisor(supervisor,{unresolved:()=>rows});
 await expect(gate.launch(request)).rejects.toThrow(/startup recovery/);
 await expect(gate.reconcile()).rejects.toThrow(/unresolved durable/);
 expect(supervisor.reconcile).not.toHaveBeenCalled();
 rows=[];await gate.reconcile();await gate.launch(request);
 expect(supervisor.launch).toHaveBeenCalledOnce();
 rows=[...unresolved];await expect(gate.launch(request)).rejects.toThrow(/unresolved durable/);
 rows=[];await expect(gate.launch(request)).rejects.toThrow(/startup recovery/);
});

test('startup gate rejects reconciliation failures and concurrent admission',async()=>{
 const supervisor=fixture();let release!:()=>void;
 const pending=new Promise<void>(r=>{release=r});
 supervisor.reconcile.mockImplementationOnce(async()=>{await pending});
 const gate=createRecoveryGatedWorkerSupervisor(supervisor,{unresolved:()=>[]});
 const checking=gate.reconcile();
 await expect(gate.launch(request)).rejects.toThrow(/startup recovery/);
 release();await checking;await gate.launch(request);
 supervisor.reconcile.mockRejectedValueOnce(new Error('kernel inspection failed'));
 await expect(gate.reconcile()).rejects.toThrow(/kernel inspection failed/);
 await expect(gate.launch(request)).rejects.toThrow(/startup recovery/);
});
