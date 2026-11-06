import { describe,expect,it } from 'vitest';
import { createSyntheticGrantIssuer } from '../../src/agents/worker-grant-issuer.js';
const id={coordinationRunId:'run',workerId:'worker',attempt:0};
const model={provider:'openai',name:'synthetic'};

describe('GE-04 Q3.6 synthetic issuer fixture',()=>{
  it('issues only registered trusted execution identities',()=>{
    const issuer=createSyntheticGrantIssuer();
    expect(()=>issuer.issue(id)).toThrow();
    issuer.registerTrustedPlan(id,model);
    expect(issuer.issue(id).config.allowedProviders).toEqual(['openai']);
  });
  it('rejects worker, run, and attempt substitution',()=>{
    const issuer=createSyntheticGrantIssuer(); issuer.registerTrustedPlan(id,model);
    for(const changed of [{...id,workerId:'other'},{...id,coordinationRunId:'other'},{...id,attempt:1}]) {
      expect(()=>issuer.issue(changed)).toThrow();
    }
  });
  it('rejects replay and reconstructed grants',()=>{
    const issuer=createSyntheticGrantIssuer(); issuer.registerTrustedPlan(id,model);
    const grant=issuer.issue(id);
    expect(()=>issuer.consume(id,structuredClone(grant))).toThrow();
    issuer.consume(id,grant);
    expect(()=>issuer.consume(id,grant)).toThrow();
    expect(()=>issuer.issue(id)).toThrow();
  });
  it('invalidates prior attempt and refuses stale registration',()=>{
    const issuer=createSyntheticGrantIssuer(); issuer.registerTrustedPlan(id,model);
    const old=issuer.issue(id);
    issuer.registerTrustedPlan({...id,attempt:1},model);
    expect(()=>issuer.issue(id)).toThrow();
    expect(()=>issuer.consume(id,old)).toThrow();
    expect(()=>issuer.registerTrustedPlan(id,model)).toThrow();
    expect(issuer.issue({...id,attempt:1}).identity.attempt).toBe(1);
  });
  it('rejects route substitution without changing trusted plan',()=>{
    const issuer=createSyntheticGrantIssuer(); issuer.registerTrustedPlan(id,model);
    const grant=issuer.issue(id);
    expect(grant.config.model.provider).toBe('openai');
    expect(()=>issuer.consume(id,{...grant,config:{...grant.config,allowedProviders:['openai','google']}})).toThrow();
  });
});
