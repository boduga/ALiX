import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CoordinationStore} from '../../src/coordination/kernel/coordination-store.js';
import {createCoordinationRun,createWorkerAssignment} from '../../src/coordination/kernel/coordination-types.js';
import {qualifyAndClaimSchedulerWorkerRoute} from '../../src/coordination/kernel/worker-scheduler-route-qualification.js';
import {getSharedLedger,closeSharedLedger} from '../../src/runtime-state/storage/runtime-ledger.js';
const authorized={provider:'openai',name:'primary',routing:{fallbacks:[{provider:'anthropic',name:'secondary'}]}};
async function fixture(){const cwd=mkdtempSync(join(tmpdir(),'ge04-q315-'));const store=new CoordinationStore(cwd);const run=createCoordinationRun({sessionId:'s',rootGoal:'qualification',coordinatorAgentId:'alix'});await store.save(run);const worker=createWorkerAssignment({coordinationRunId:run.id,agentId:'w',taskLabel:'test',goalPrompt:'test',requiredCapabilities:['task.do'],attempt:0,maxAttempts:3});await store.addWorker(run.id,worker);const args={store,run,worker,config:{models:{default:authorized}},tier:'default' as const,patch:{executionOwnerId:'scheduler'},routeRevision:1};return {cwd,store,run,worker,args,cleanup:()=>{closeSharedLedger(cwd);rmSync(cwd,{recursive:true,force:true});}};}
describe('GE-04 Q3.15 scheduler canonical route qualification',()=>{
 it('persists canonical route with claim and ignores worker authority inputs',async()=>{const f=await fixture();try{assert.equal(await qualifyAndClaimSchedulerWorkerRoute({...f.args,proposedWorkerRoute:authorized}),true);const w=(await new CoordinationStore(f.cwd).load(f.run.id))!.workers[0]!;assert.deepEqual(w.trustedRouteSnapshot?.evidence.candidates.map(c=>[c.provider,c.name]),[['openai','primary'],['anthropic','secondary']]);}finally{f.cleanup();}});
 it('rejects substituted primary and fallback without ledger append',async()=>{for(const proposed of [{...authorized,name:'other'},{...authorized,routing:{fallbacks:[{provider:'openai',name:'other'}]}}]){const f=await fixture();try{const before=getSharedLedger(f.cwd).entityVersion(f.run.id);await assert.rejects(()=>qualifyAndClaimSchedulerWorkerRoute({...f.args,proposedWorkerRoute:proposed}));assert.equal(getSharedLedger(f.cwd).entityVersion(f.run.id),before);}finally{f.cleanup();}}});
 it('rejects unresolved canonical selection and stale plan',async()=>{const f=await fixture();try{const before=getSharedLedger(f.cwd).entityVersion(f.run.id);await assert.rejects(()=>qualifyAndClaimSchedulerWorkerRoute({...f.args,config:{models:{default:{...authorized,selection:{}} as any}}}));assert.equal(await qualifyAndClaimSchedulerWorkerRoute({...f.args,run:{...f.run,planRevision:f.run.planRevision+1}}),false);assert.equal(getSharedLedger(f.cwd).entityVersion(f.run.id),before);}finally{f.cleanup();}});
});
