import { describe, expect, it } from 'vitest';
import { assertWorkerGrantUse, bindWorkerGrant } from '../../src/agents/worker-grant-binding.js';

const identity={coordinationRunId:'synthetic-run',workerId:'synthetic-worker',attempt:0};
const model={provider:'openai',name:'synthetic-model',routing:{fallbacks:[{provider:'anthropic',name:'backup'}]}};

describe('GE-04 Q3.5 pure worker grant binding (test-only)',()=>{
  it('binds identity to resolved route and copies immutable metadata',()=>{
    const binding=bindWorkerGrant(identity,model);
    expect(binding).toEqual({identity,config:{model:{provider:'openai',name:'synthetic-model'},allowedProviders:['openai','anthropic']}});
    expect(Object.isFrozen(binding)).toBe(true);
    expect(Object.isFrozen(binding.identity)).toBe(true);
    assertWorkerGrantUse(binding,identity,model);
  });
  it('rejects run, worker and attempt substitution',()=>{
    const binding=bindWorkerGrant(identity,model);
    expect(()=>assertWorkerGrantUse(binding,{...identity,coordinationRunId:'other'},model)).toThrow();
    expect(()=>assertWorkerGrantUse(binding,{...identity,workerId:'other'},model)).toThrow();
    expect(()=>assertWorkerGrantUse(binding,{...identity,attempt:1},model)).toThrow();
  });
  it('rejects primary model substitution and fallback expansion',()=>{
    const binding=bindWorkerGrant(identity,model);
    expect(()=>assertWorkerGrantUse(binding,identity,{...model,name:'other'})).toThrow();
    expect(()=>assertWorkerGrantUse(binding,identity,{...model,provider:'google'})).toThrow();
    expect(()=>assertWorkerGrantUse(binding,identity,{...model,routing:{fallbacks:[...model.routing.fallbacks,{provider:'google',name:'extra'}]}})).toThrow();
  });
  it('rejects malformed identities and unresolved models',()=>{
    expect(()=>bindWorkerGrant({...identity,attempt:-1},model)).toThrow();
    expect(()=>bindWorkerGrant({...identity,attempt:1.5},model)).toThrow();
    expect(()=>bindWorkerGrant({...identity,workerId:' '},model)).toThrow();
    expect(()=>bindWorkerGrant(identity,{...model,selection:{provider:'openai'}} as any)).toThrow();
  });
  it('rejects forged provider expansion in a supplied binding',()=>{
    const binding=bindWorkerGrant(identity,model);
    expect(()=>assertWorkerGrantUse({...binding,config:{...binding.config,allowedProviders:['openai','anthropic','google']}},identity,model)).toThrow();
  });
});
