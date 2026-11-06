import { describe, expect, it } from 'vitest';
import { createSyntheticGrantAuthority } from '../../src/agents/worker-grant-authority.js';
const identity = {coordinationRunId:'run',workerId:'worker',attempt:0};
const model = {provider:'openai',name:'synthetic'};

describe('GE-04 Q3.7 synthetic authority ports',()=>{
  it('does not expose registration through worker-facing access port',()=>{
    const {scheduler,access}=createSyntheticGrantAuthority();
    expect(Object.keys(access).sort()).toEqual(['consume','issue']);
    expect('registerTrustedPlan' in access).toBe(false);
    expect('issue' in scheduler).toBe(false);
    expect(Object.isFrozen(access)).toBe(true);
    expect(()=>access.issue(identity)).toThrow();
    scheduler.registerTrustedPlan(identity,model);
    expect(access.issue(identity).config.allowedProviders).toEqual(['openai']);
  });
  it('rejects unauthorized identity and replay via access port',()=>{
    const {scheduler,access}=createSyntheticGrantAuthority();
    scheduler.registerTrustedPlan(identity,model);
    const binding=access.issue(identity);
    expect(()=>access.issue({...identity,workerId:'other'})).toThrow();
    expect(()=>access.consume({...identity,attempt:1},binding)).toThrow();
    access.consume(identity,binding);
    expect(()=>access.consume(identity,binding)).toThrow();
  });
  it('rejects stale attempts after scheduler replacement',()=>{
    const {scheduler,access}=createSyntheticGrantAuthority();
    scheduler.registerTrustedPlan(identity,model);
    const old=access.issue(identity);
    scheduler.registerTrustedPlan({...identity,attempt:1},model);
    expect(()=>access.consume(identity,old)).toThrow();
    expect(access.issue({...identity,attempt:1}).identity.attempt).toBe(1);
  });
  it('keeps separate authority instances independent',()=>{
    const first=createSyntheticGrantAuthority();
    const second=createSyntheticGrantAuthority();
    first.scheduler.registerTrustedPlan(identity,model);
    expect(()=>second.access.issue(identity)).toThrow();
    expect(first.access.issue(identity).identity).toEqual(identity);
  });
});
