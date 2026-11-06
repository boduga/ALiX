import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CoordinationStore} from '../../src/coordination/kernel/coordination-store.js';
import {createCoordinationRun,createWorkerAssignment} from '../../src/coordination/kernel/coordination-types.js';
import {closeSharedLedger} from '../../src/runtime-state/storage/runtime-ledger.js';
import {qualifyAndClaimSchedulerWorkerRoute} from '../../src/coordination/kernel/worker-scheduler-route-qualification.js';
import {qualifyDurableExecutorRouteContract,assertExecutorRouteContractMatches} from '../../src/agents/worker-executor-route-contract.js';
const model={provider:'openai',name:'primary',routing:{fallbacks:[{provider:'anthropic',name:'backup'}]}};
const config={models:{default:model}};
async function fixture(){const cwd=mkdtempSync(join(tmpdir(),'ge04-q317-'));const store=new CoordinationStore(cwd);const run=createCoordinationRun({sessionId:'s',rootGoal:'route',coordinatorAgentId:'alix'});await store.save(run);const worker=createWorkerAssignment({coordinationRunId:run.id,agentId:'w',taskLabel:'route',goalPrompt:'test',requiredCapabilities:['task.do'],attempt:0,maxAttempts:3});await store.addWorker(run.id,worker);const identity={coordinationRunId:run.id,workerId:worker.id,attempt:1};const args={store,identity,ownerId:'daemon',schedulerConfig:config,schedulerTier:'default' as const,executorRoute:model};return {cwd,store,run,worker,args,cleanup:()=>{closeSharedLedger(cwd);rmSync(cwd,{recursive:true,force:true});}};}
async function claim(f:Awaited<ReturnType<typeof fixture>>){assert.equal(await qualifyAndClaimSchedulerWorkerRoute({store:f.store,run:f.run,worker:f.worker,config,tier:'default',patch:{executionOwnerId:'daemon'},routeRevision:1}),true);}
describe('GE-04 Q3.17 durable executor route contract',()=>{
 it('fails closed before claim, then derives immutable primary and fallbacks from fresh ledger',async()=>{const f=await fixture();try{await assert.rejects(()=>qualifyDurableExecutorRouteContract(f.args));await claim(f);const c=await qualifyDurableExecutorRouteContract({...f.args,store:new CoordinationStore(f.cwd)});assert.deepEqual(c.primary,{provider:'openai',name:'primary'});assert.deepEqual(c.fallbacks,[{provider:'anthropic',name:'backup'}]);assert.ok(Object.isFrozen(c));assert.doesNotThrow(()=>assertExecutorRouteContractMatches(c,model));}finally{f.cleanup();}});
 it('rejects child CLI route missing fallbacks and model substitution',async()=>{const f=await fixture();try{await claim(f);await assert.rejects(()=>qualifyDurableExecutorRouteContract({...f.args,executorRoute:{provider:'openai',name:'primary'}}));const c=await qualifyDurableExecutorRouteContract(f.args);assert.throws(()=>assertExecutorRouteContractMatches(c,{...model,name:'other'}));}finally{f.cleanup();}});
 it('rejects owner and attempt drift and revoked snapshot',async()=>{const f=await fixture();try{await claim(f);await assert.rejects(()=>qualifyDurableExecutorRouteContract({...f.args,ownerId:'other'}));await assert.rejects(()=>qualifyDurableExecutorRouteContract({...f.args,identity:{...f.args.identity,attempt:2}}));await f.store.patchWorker(f.run.id,f.worker.id,{trustedRouteSnapshot:{...(await f.store.load(f.run.id))!.workers[0]!.trustedRouteSnapshot!,revoked:true}});await assert.rejects(()=>qualifyDurableExecutorRouteContract(f.args));}finally{f.cleanup();}});
 it('does not treat unresolved scheduler selection as a resolved contract',async()=>{const f=await fixture();try{await claim(f);await assert.rejects(()=>qualifyDurableExecutorRouteContract({...f.args,schedulerConfig:{models:{default:{...model,selection:{}} as any}}}));}finally{f.cleanup();}});
});
