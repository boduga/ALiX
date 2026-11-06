import {describe,it,expect} from 'vitest';
import {createSyntheticRouteSnapshot,assertSyntheticRouteSnapshot,revokeSyntheticRouteSnapshot} from '../../src/agents/worker-route-snapshot.js';
const id={coordinationRunId:'run',workerId:'worker',attempt:1};
const record={runId:'run',workerId:'worker',attempt:1,status:'running',executionOwnerId:'daemon',planRevision:2};
const model={provider:'openai',name:'primary',routing:{fallbacks:[{provider:'anthropic',name:'backup'}]}};
const make=()=>createSyntheticRouteSnapshot(record,id,'daemon',2,model,1);
const check=(snapshot:ReturnType<typeof make>,r=record,i=id,owner='daemon',revision=2,m=model,routeRevision=1)=>assertSyntheticRouteSnapshot(snapshot,r,i,owner,revision,m,routeRevision);
describe('GE-04 Q3.11 synthetic snapshot lifecycle',()=>{
 it('captures a versioned route snapshot for a qualified claim',()=>{const s=make();expect(s.schemaVersion).toBe(1);expect(s.routeRevision).toBe(1);expect(Object.isFrozen(s)).toBe(true);expect(()=>check(s)).not.toThrow();});
 it('rejects retry and owner handoff',()=>{const s=make();expect(()=>check(s,{...record,attempt:2},{...id,attempt:2})).toThrow();expect(()=>check(s,{...record,executionOwnerId:'other'},id,'other')).toThrow();});
 it('rejects replan, route change and route revision mismatch',()=>{const s=make();expect(()=>check(s,{...record,planRevision:3},id,'daemon',3)).toThrow();expect(()=>check(s,record,id,'daemon',2,{...model,name:'changed'})).toThrow();expect(()=>check(s,record,id,'daemon',2,model,2)).toThrow();});
 it('rejects revoked snapshots and malformed revisions',()=>{const s=make();expect(()=>check(revokeSyntheticRouteSnapshot(s))).toThrow();expect(()=>createSyntheticRouteSnapshot(record,id,'daemon',2,model,0)).toThrow();});
});
