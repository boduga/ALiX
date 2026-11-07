import {expect,test,vi} from 'vitest';
import {createDurableLaunchWorkerSupervisor} from '../../src/agents/worker-supervisor-durable-launch.js';
const identity={coordinationRunId:'run',workerId:'w',attempt:1};
const request={identity,configurationId:'c',workspaceRoot:'/usr'};
const evidence={identity,pid:101,uid:20002,startTimeTicks:'123',registrationId:'native-reg'};
const handle={evidence,cancel:vi.fn(async()=>{}),wait:vi.fn(async()=>({exitCode:0,signal:null}))};
const fixture=()=>({launch:vi.fn(async()=>handle),revoke:vi.fn(async()=>{}),reconcile:vi.fn(async()=>{})});

test('intent is durably written before worker spawn and promoted after qualification',async()=>{
 const events:string[]=[];
 const supervisor=fixture();supervisor.launch.mockImplementation(async()=>{events.push('spawn');return handle});
 const store={beginLaunch:vi.fn((_intent:unknown)=>{events.push('intent')}),promoteLaunch:vi.fn((_record:unknown)=>{events.push('promote')})};
 const wrapped=createDurableLaunchWorkerSupervisor(supervisor,store);
 expect(await wrapped.launch(request)).toBe(handle);
 expect(events).toEqual(['intent','spawn','promote']);
 expect(store.promoteLaunch.mock.calls[0]![0]).toMatchObject({worker:identity,process:{pid:101,uid:20002,startTimeTicks:'123'}});
 expect((store.beginLaunch.mock.calls[0]![0] as {registrationId:string}).registrationId).toBe((store.promoteLaunch.mock.calls[0]![0] as {registrationId:string}).registrationId);
});

test('intent write failure prevents spawn',async()=>{
 const supervisor=fixture();const wrapped=createDurableLaunchWorkerSupervisor(supervisor,{
  beginLaunch:()=>{throw new Error('disk full')},promoteLaunch:()=>{}});
 await expect(wrapped.launch(request)).rejects.toThrow('disk full');
 expect(supervisor.launch).not.toHaveBeenCalled();
});

test('unknown spawn outcome leaves durable intent unresolved',async()=>{
 const supervisor=fixture();supervisor.launch.mockRejectedValueOnce(new Error('spawn outcome unknown'));
 const begin=vi.fn();const promote=vi.fn();
 const wrapped=createDurableLaunchWorkerSupervisor(supervisor,{beginLaunch:begin,promoteLaunch:promote});
 await expect(wrapped.launch(request)).rejects.toThrow('spawn outcome unknown');
 expect(begin).toHaveBeenCalledOnce();expect(promote).not.toHaveBeenCalled();
});

test('promotion failure cancels worker but leaves intent unresolved',async()=>{
 const supervisor=fixture();const begin=vi.fn();handle.cancel.mockClear();
 const wrapped=createDurableLaunchWorkerSupervisor(supervisor,{beginLaunch:begin,
  promoteLaunch:()=>{throw new Error('commit failed')}});
 await expect(wrapped.launch(request)).rejects.toThrow('commit failed');
 expect(handle.cancel).toHaveBeenCalledOnce();expect(begin).toHaveBeenCalledOnce();
});
