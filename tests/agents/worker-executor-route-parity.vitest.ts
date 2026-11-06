import {describe,it,expect} from 'vitest';
import {describeCurrentChildCliRoute,assertExecutorRouteParity} from '../../src/agents/worker-executor-route-parity.js';
import {createSyntheticRouteSnapshot} from '../../src/agents/worker-route-snapshot.js';
const authorized={provider:'openai',name:'primary',routing:{fallbacks:[{provider:'anthropic',name:'backup'}]}};
const config={models:{default:authorized}};
const identity={coordinationRunId:'r',workerId:'w',attempt:1};
const record={runId:'r',workerId:'w',attempt:1,status:'running',executionOwnerId:'daemon',planRevision:1};
const snapshot=createSyntheticRouteSnapshot(record,identity,'daemon',1,authorized,1);
const args={snapshot,record,identity,ownerId:'daemon',planRevision:1,routeRevision:1,schedulerConfig:config,schedulerTier:'default' as const};
describe('GE-04 Q3.16 scheduler/executor parity qualification',()=>{
 it('accepts exact primary and ordered fallback chain',()=>expect(()=>assertExecutorRouteParity({...args,executorRoute:authorized})).not.toThrow());
 it('detects current child CLI dropping fallbacks even when primary matches',()=>{const actual=describeCurrentChildCliRoute(config,'default',{provider:'openai',name:'primary'});expect(actual).toEqual({provider:'openai',name:'primary'});expect(()=>assertExecutorRouteParity({...args,executorRoute:actual})).toThrow();});
 it('rejects substituted primary and reordered fallback chain',()=>{expect(()=>assertExecutorRouteParity({...args,executorRoute:{...authorized,name:'other'}})).toThrow();expect(()=>assertExecutorRouteParity({...args,executorRoute:{...authorized,routing:{fallbacks:[{provider:'openai',name:'x'},{provider:'anthropic',name:'backup'}]}}})).toThrow();});
 it('rejects owner/attempt/plan/route revision drift and revoked snapshot',()=>{for(const change of [{ownerId:'other'},{identity:{...identity,attempt:2}},{planRevision:2},{routeRevision:2},{snapshot:{...snapshot,revoked:true}}])expect(()=>assertExecutorRouteParity({...args,...change,executorRoute:authorized})).toThrow();});
 it('rejects unresolved selection rather than treating a CLI override as authority',()=>{const selected={models:{default:{...authorized,selection:{}} as any}};expect(()=>assertExecutorRouteParity({...args,schedulerConfig:selected,executorRoute:authorized})).toThrow();});
});
