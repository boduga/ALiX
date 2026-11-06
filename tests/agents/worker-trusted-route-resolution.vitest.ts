import {describe,expect,it} from 'vitest';
import {resolveSyntheticTrustedWorkerRoute,assertSyntheticWorkerRouteMatches} from '../../src/agents/worker-trusted-route-resolution.js';
const model={provider:'openai',name:'primary',routing:{fallbacks:[{provider:'anthropic',name:'backup'}]}};
const config={models:{default:{provider:'openrouter',name:'default'},fast:model}};
describe('GE-04 Q3.10 canonical tier route qualification',()=>{
  it('resolves configured tier and retains complete ordered fallback route',()=>{
    const resolved=resolveSyntheticTrustedWorkerRoute(config as any,'fast');
    expect(resolved).toEqual(model);
    expect(resolved).not.toBe(model);
    expect(()=>assertSyntheticWorkerRouteMatches(resolved,model)).not.toThrow();
  });
  it('rejects dynamic selection until trusted discovery resolves it',()=>{
    expect(()=>resolveSyntheticTrustedWorkerRoute({models:{default:{...model,selection:{}}}} as any,'default')).toThrow();
  });
  it('rejects worker primary and fallback substitutions',()=>{
    const authorized=resolveSyntheticTrustedWorkerRoute(config as any,'fast');
    expect(()=>assertSyntheticWorkerRouteMatches(authorized,{...model,name:'changed'})).toThrow();
    expect(()=>assertSyntheticWorkerRouteMatches(authorized,{...model,routing:{fallbacks:[{provider:'openai',name:'backup'}]}})).toThrow();
    expect(()=>assertSyntheticWorkerRouteMatches(authorized,{...model,routing:{fallbacks:[]}})).toThrow();
  });
  it('does not authorize a missing canonical model',()=>{
    expect(()=>resolveSyntheticTrustedWorkerRoute({models:{}} as any,'default')).toThrow();
  });
});
