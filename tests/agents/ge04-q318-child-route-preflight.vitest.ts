import {describe,it,expect} from 'vitest';
import {assertChildProviderRouteSupported} from '../../src/agents/worker-child-route-preflight.js';
import type {QualifiedExecutorRouteContract} from '../../src/agents/worker-executor-route-contract.js';
const base:QualifiedExecutorRouteContract={schemaVersion:1,identity:{coordinationRunId:'r',workerId:'w',attempt:1},ownerId:'daemon',planRevision:1,routeRevision:1,primary:{provider:'openai',name:'m'},fallbacks:[]};
describe('GE-04 Q3.18 child provider preflight',()=>{
 it('accepts exact single-model route',()=>expect(()=>assertChildProviderRouteSupported(base,{provider:'openai',name:'m'})).not.toThrow());
 it('rejects a contract with fallbacks rather than silently dropping them',()=>expect(()=>assertChildProviderRouteSupported({...base,fallbacks:[{provider:'anthropic',name:'backup'}]},{provider:'openai',name:'m'})).toThrow(/fallbacks/));
 it('rejects provider or model substitution',()=>{expect(()=>assertChildProviderRouteSupported(base,{provider:'anthropic',name:'m'})).toThrow();expect(()=>assertChildProviderRouteSupported(base,{provider:'openai',name:'other'})).toThrow();});
 it('rejects unresolved selection',()=>expect(()=>assertChildProviderRouteSupported(base,{provider:'openai',name:'m',selection:{} as any})).toThrow());
});
