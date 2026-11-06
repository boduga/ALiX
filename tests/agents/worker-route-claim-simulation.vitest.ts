import {describe,it,expect} from 'vitest';
import {simulateAtomicRouteClaim,assertSyntheticClaimReplay} from '../../src/agents/worker-route-claim-simulation.js';
import {revokeSyntheticRouteSnapshot} from '../../src/agents/worker-route-snapshot.js';
const model={provider:'openai',name:'primary',routing:{fallbacks:[{provider:'anthropic',name:'backup'}]}};
const initial=()=>({record:{runId:'run',workerId:'worker',attempt:0,status:'pending',planRevision:3},snapshot:null});
const claim=(s=initial())=>simulateAtomicRouteClaim(s,0,'daemon',model,1,3);
describe('GE-04 Q3.12 synthetic atomic claim and replay',()=>{
 it('qualifies route and claim as one returned state',()=>{const s=claim();expect(s.record.attempt).toBe(1);expect(s.snapshot?.evidence.identity.attempt).toBe(1);expect(()=>assertSyntheticClaimReplay(s,model,1)).not.toThrow();});
 it('rejects competing claim and stale attempt without modifying original',()=>{const before=initial();const first=claim(before);expect(()=>claim(first as any)).toThrow();expect(()=>simulateAtomicRouteClaim(before,1,'daemon',model,1,3)).toThrow();expect(before.record.status).toBe('pending');expect(before.snapshot).toBeNull();});
 it('route qualification failure leaves pending state unchanged',()=>{const before=initial();expect(()=>simulateAtomicRouteClaim(before,0,'daemon',{...model,selection:{}} as any,1,3)).toThrow();expect(before).toEqual(initial());});
 it('rejects replan at claim and replay, and missing snapshot after simulated crash',()=>{const before=initial();expect(()=>simulateAtomicRouteClaim(before,0,'daemon',model,1,4)).toThrow();const committed=claim();expect(()=>assertSyntheticClaimReplay({...committed,record:{...committed.record,planRevision:4}},model,1)).toThrow();expect(()=>assertSyntheticClaimReplay({...committed,snapshot:null},model,1)).toThrow();});
 it('rejects replay after revocation, ownership change or route substitution',()=>{const committed=claim();expect(()=>assertSyntheticClaimReplay({...committed,snapshot:revokeSyntheticRouteSnapshot(committed.snapshot!)},model,1)).toThrow();expect(()=>assertSyntheticClaimReplay({...committed,record:{...committed.record,executionOwnerId:'other'}},model,1)).toThrow();expect(()=>assertSyntheticClaimReplay(committed,{...model,name:'other'},1)).toThrow();});
});
