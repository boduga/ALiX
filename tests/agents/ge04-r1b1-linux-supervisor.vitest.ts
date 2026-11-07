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
