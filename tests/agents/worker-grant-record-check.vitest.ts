import {describe,expect,it} from 'vitest';
import {assertClaimedWorkerRecord} from '../../src/agents/worker-grant-record-check.js';
const identity={coordinationRunId:'run',workerId:'worker',attempt:1};
const record={runId:'run',workerId:'worker',attempt:1,status:'running',executionOwnerId:'daemon',planRevision:3};
const check=(r:typeof record|null, id=identity,owner='daemon',revision=3)=>assertClaimedWorkerRecord(r,id,owner,revision);
describe('GE-04 Q3.8 synthetic post-claim record check',()=>{
  it('accepts matching persisted-style running record',()=>expect(()=>check(record)).not.toThrow());
  it('fails closed on missing or nonrunning record',()=>{
    expect(()=>check(null)).toThrow();
    for(const status of ['pending','blocked','completed','failed']) expect(()=>check({...record,status})).toThrow();
  });
  it('rejects identity and stale attempt mismatch',()=>{
    expect(()=>check({...record,workerId:'other'})).toThrow();
    expect(()=>check({...record,runId:'other'})).toThrow();
    expect(()=>check({...record,attempt:0})).toThrow();
    expect(()=>check(record,{...identity,attempt:2})).toThrow();
  });
  it('rejects owner and plan revision mismatch',()=>{
    expect(()=>check(record,identity,'other')).toThrow();
    expect(()=>check(record,identity,'daemon',4)).toThrow();
    expect(()=>check({...record,executionOwnerId:''})).toThrow();
    expect(()=>check({...record,planRevision:-1})).toThrow();
  });
});
