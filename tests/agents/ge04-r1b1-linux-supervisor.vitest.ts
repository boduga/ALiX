import {test,expect,vi} from 'vitest';
import {createLinuxWorkerSupervisor} from '../../src/agents/worker-supervisor-linux.js';
const request={identity:{coordinationRunId:'run',workerId:'worker',attempt:1},configurationId:'nonsecret',workspaceRoot:'/tmp'};
const proc={pid:42001,uid:20002,startTimeTicks:'1234'};
const fixture=()=>({ ...proc,terminate:vi.fn(async()=>{}),wait:vi.fn(async()=>({exitCode:0,signal:null})) });

test.skipIf(process.platform!=='linux')('qualifies independently observed process and revokes on cancellation',async()=>{
 const child=fixture();const supervisor=createLinuxWorkerSupervisor({launch:async()=>child},async()=>proc);
 const handle=await supervisor.launch(request);
 expect(handle.evidence).toMatchObject(proc);
 await expect(supervisor.launch(request)).rejects.toThrow(/Duplicate/);
 await handle.cancel('test');expect(child.terminate).toHaveBeenCalledOnce();
});
test.skipIf(process.platform!=='linux')('rejects forged UID and terminates unqualified child',async()=>{
 const child=fixture();const supervisor=createLinuxWorkerSupervisor({launch:async()=>child},async()=>({...proc,uid:20003}));
 await expect(supervisor.launch(request)).rejects.toThrow(/mismatch/);
 expect(child.terminate).toHaveBeenCalledOnce();
});
test.skipIf(process.platform!=='linux')('rejects same-UID process even if identity matches',async()=>{
 const child={...fixture(),uid:process.getuid!()};const supervisor=createLinuxWorkerSupervisor({launch:async()=>child},async()=>({...proc,uid:child.uid}));
 await expect(supervisor.launch(request)).rejects.toThrow(/same-UID/);
 expect(child.terminate).toHaveBeenCalledOnce();
});
test.skipIf(process.platform!=='linux')('reconcile terminates stale process generation',async()=>{
 const child=fixture();let start='1234';const supervisor=createLinuxWorkerSupervisor({launch:async()=>child},async()=>({...proc,startTimeTicks:start}));
 await supervisor.launch(request);start='1235';await supervisor.reconcile();expect(child.terminate).toHaveBeenCalledOnce();
});
test.skipIf(process.platform!=='linux')('denies duplicate while launch is pending',async()=>{
 let release!:()=>void;const pending=new Promise<void>(r=>{release=r});const child=fixture();
 const supervisor=createLinuxWorkerSupervisor({launch:async()=>{await pending;return child;}},async()=>proc);
 const first=supervisor.launch(request);await expect(supervisor.launch(request)).rejects.toThrow(/Duplicate/);
 release();await first;
});

test.skipIf(process.platform!=='linux')('failed termination retains registration and can be retried',async()=>{
 const child=fixture();
 child.terminate.mockRejectedValueOnce(new Error('kill failed'));
 const supervisor=createLinuxWorkerSupervisor({launch:async()=>child},async()=>proc);
 await supervisor.launch(request);
 await expect(supervisor.revoke(request.identity)).rejects.toThrow('kill failed');
 await expect(supervisor.launch(request)).rejects.toThrow(/Duplicate/);
 await supervisor.revoke(request.identity);
 expect(child.terminate).toHaveBeenCalledTimes(2);
});
test.skipIf(process.platform!=='linux')('concurrent cancellation shares one termination',async()=>{
 let release!:()=>void;
 const pending=new Promise<void>(resolve=>{release=resolve});
 const child=fixture();child.terminate.mockImplementation(async()=>{await pending});
 const supervisor=createLinuxWorkerSupervisor({launch:async()=>child},async()=>proc);
 await supervisor.launch(request);
 const first=supervisor.revoke(request.identity);
 const second=supervisor.revoke(request.identity);
 await Promise.resolve();
 expect(child.terminate).toHaveBeenCalledOnce();
 await expect(supervisor.launch(request)).rejects.toThrow(/Duplicate/);
 release();await Promise.all([first,second]);
});

test.skipIf(process.platform!=='linux')('failed wait retains registration for subsequent revocation',async()=>{
 const child=fixture();child.wait.mockRejectedValueOnce(new Error('wait interrupted'));
 const supervisor=createLinuxWorkerSupervisor({launch:async()=>child},async()=>proc);
 const handle=await supervisor.launch(request);
 await expect(handle.wait()).rejects.toThrow('wait interrupted');
 await expect(supervisor.launch(request)).rejects.toThrow(/Duplicate/);
 await supervisor.revoke(request.identity);
 expect(child.terminate).toHaveBeenCalledOnce();
});

test.skipIf(process.platform!=='linux')('failed qualification cleanup quarantines worker until revocation succeeds',async()=>{
 const child=fixture();child.terminate.mockRejectedValueOnce(new Error('termination unavailable'));
 const supervisor=createLinuxWorkerSupervisor({launch:async()=>child},async()=>({...proc,uid:20003}));
 await expect(supervisor.launch(request)).rejects.toThrow(/mismatch/);
 await expect(supervisor.launch(request)).rejects.toThrow(/quarantined/);
 await supervisor.revoke(request.identity);
 expect(child.terminate).toHaveBeenCalledTimes(2);
});

test.skipIf(process.platform!=='linux')('concurrent quarantined revocations share termination and block relaunch',async()=>{
 let release!:()=>void;
 const pending=new Promise<void>(resolve=>{release=resolve});
 const child=fixture();
 child.terminate.mockRejectedValueOnce(new Error('cleanup failed'));
 child.terminate.mockImplementationOnce(async()=>{await pending});
 const supervisor=createLinuxWorkerSupervisor({launch:async()=>child},async()=>({...proc,uid:20003}));
 await expect(supervisor.launch(request)).rejects.toThrow(/mismatch/);
 const a=supervisor.revoke(request.identity);
 const b=supervisor.reconcile();
 await Promise.resolve();await Promise.resolve();
 await expect(supervisor.launch(request)).rejects.toThrow(/quarantined/);
 release();await Promise.all([a,b]);
 expect(child.terminate).toHaveBeenCalledTimes(2);
});

test.skipIf(process.platform!=='linux')('concurrent waits share one native reap and reject stale handle',async()=>{
 let release!:()=>void;
 const pending=new Promise<void>(resolve=>{release=resolve});
 const child=fixture();child.wait.mockImplementation(async()=>{await pending;return {exitCode:0,signal:null}});
 const supervisor=createLinuxWorkerSupervisor({launch:async()=>child},async()=>proc);
 const handle=await supervisor.launch(request);
 const first=handle.wait();const second=handle.wait();
 await Promise.resolve();await Promise.resolve();
 expect(child.wait).toHaveBeenCalledOnce();
 release();await Promise.all([first,second]);
 await expect(handle.wait()).rejects.toThrow(/no longer active/);
});
