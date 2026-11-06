import {describe,expect,it} from 'vitest';
import {captureSyntheticRouteEvidence,assertSyntheticRouteEvidence} from '../../src/agents/worker-route-authority.js';
const identity={coordinationRunId:'run',workerId:'worker',attempt:1};
const record={runId:'run',workerId:'worker',attempt:1,status:'running',executionOwnerId:'daemon',planRevision:3};
const model={provider:'openai',name:'primary',routing:{fallbacks:[{provider:'anthropic',name:'backup'}]}};
const capture=()=>captureSyntheticRouteEvidence(record,identity,'daemon',3,model);
describe('GE-04 Q3.9 synthetic route evidence',()=>{
  it('captures ordered concrete primary and fallback candidates',()=>{
    const evidence=capture();
    expect(evidence.candidates).toEqual([{provider:'openai',name:'primary'},{provider:'anthropic',name:'backup'}]);
    expect(Object.isFrozen(evidence.candidates)).toBe(true);
    expect(()=>assertSyntheticRouteEvidence(evidence,record,identity,'daemon',3,model)).not.toThrow();
  });
  it('rejects primary or fallback route substitution',()=>{
    const evidence=capture();
    expect(()=>assertSyntheticRouteEvidence(evidence,record,identity,'daemon',3,{...model,name:'other'})).toThrow();
    expect(()=>assertSyntheticRouteEvidence(evidence,record,identity,'daemon',3,{...model,routing:{fallbacks:[{provider:'openai',name:'backup'}]}})).toThrow();
    expect(()=>assertSyntheticRouteEvidence(evidence,record,identity,'daemon',3,{...model,routing:{fallbacks:[]}})).toThrow();
  });
  it('rejects stale attempt, owner, revision and non-running state',()=>{
    const evidence=capture();
    expect(()=>assertSyntheticRouteEvidence(evidence,{...record,attempt:2},identity,'daemon',3,model)).toThrow();
    expect(()=>assertSyntheticRouteEvidence(evidence,record,identity,'other',3,model)).toThrow();
    expect(()=>assertSyntheticRouteEvidence(evidence,record,identity,'daemon',4,model)).toThrow();
    expect(()=>assertSyntheticRouteEvidence(evidence,{...record,status:'completed'},identity,'daemon',3,model)).toThrow();
  });
  it('rejects unresolved route and modified evidence',()=>{
    expect(()=>captureSyntheticRouteEvidence(record,identity,'daemon',3,{...model,selection:{}} as any)).toThrow();
    const evidence=capture();
    expect(()=>assertSyntheticRouteEvidence({...evidence,fingerprint:'fake'},record,identity,'daemon',3,model)).toThrow();
  });
});
