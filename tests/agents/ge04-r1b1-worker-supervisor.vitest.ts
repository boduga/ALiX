import {describe,expect,it,vi} from 'vitest';
import {requireWorkerSupervisor,unavailableWorkerSupervisor,WorkerSupervisorUnavailableError} from '../../src/agents/worker-supervisor.js';

const request={identity:{coordinationRunId:'coord-1',workerId:'worker-1',attempt:1},configurationId:'projection-1',workspaceRoot:'/tmp/work'};

describe('GE-04 R1-B1 supervisor contract (no production admission)',()=>{
  it('fails closed when authority is missing or incomplete',()=>{
    expect(()=>requireWorkerSupervisor(undefined)).toThrow(WorkerSupervisorUnavailableError);
    expect(()=>requireWorkerSupervisor({launch:vi.fn()} as never)).toThrow(WorkerSupervisorUnavailableError);
  });
  it('denies launch, revoke and recovery on unsupported hosts',async()=>{
    const supervisor=requireWorkerSupervisor(unavailableWorkerSupervisor());
    await expect(supervisor.launch(request)).rejects.toThrow(/SECURITY HOLD/);
    await expect(supervisor.revoke(request.identity)).rejects.toThrow(/SECURITY HOLD/);
    await expect(supervisor.reconcile()).rejects.toThrow(/SECURITY HOLD/);
  });
  it('exposes only an explicit nonsecret launch request',()=>{
    expect(Object.keys(request).sort()).toEqual(['configurationId','identity','workspaceRoot']);
    expect(JSON.stringify(request)).not.toMatch(/apiKeys|credentialFd|secret|DBUS_SESSION/);
  });
});
