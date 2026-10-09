import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCoordinationRun, createWorkerAssignment } from '../../src/kernel/coordination-types.js';
import { CoordinationResultStore } from '../../src/kernel/coordination-result-store.js';
import { CoordinationStore } from '../../src/kernel/coordination-store.js';
import { CoordinationScheduler } from '../../src/kernel/coordination-scheduler.js';
import { OwnershipRegistry } from '../../src/ownership/ownership-registry.js';
import { taskForWorker } from '../../src/kernel/subagent-worker-executor.js';
import { loadWorkerDependencyResults, renderWorkerExecutionPrompt } from '../../src/kernel/coordination-worker-context.js';
import { closeAllSharedLedgers } from '../../src/storage/runtime-ledger.js';

// Fire-and-forget scheduler finalization can reopen the shared ledger after
// a single close; retry close+rm until the late writer settles (Windows EBUSY,
// POSIX unlinks silently).
async function removeWorkspace(cwd:string):Promise<void>{
 for(let attempt=0;;attempt++){
  closeAllSharedLedgers();
  try{await rm(cwd,{recursive:true,force:true});return;}
  catch(err){if(attempt>=9)throw err;await new Promise(r=>setTimeout(r,25*(attempt+1)));}
 }
}

function fixture() {
 const run = createCoordinationRun({ sessionId:'session',rootGoal:'Report current president of Nigeria with verified source URLs.',coordinatorAgentId:'parent' });
 const producer = createWorkerAssignment({id:'research',coordinationRunId:run.id,agentId:'researcher',taskLabel:'Research',goalPrompt:'Research the subject',status:'completed',attempt:2});
 const worker = createWorkerAssignment({id:'writer',coordinationRunId:run.id,agentId:'writer',taskLabel:'Report',goalPrompt:'Write the president report',dependencies:[producer.id],requiredCapabilities:['filesystem.write'],ownershipScopes:['docs/report.md']});
 run.workers=[producer,worker]; return {run,producer,worker};
}
describe('coordination worker context',()=>{
 it('scheduler delivers current persisted producer findings to dependent executor',async()=>{
  const cwd=await mkdtemp(join(tmpdir(),'alix-worker-context-scheduler-'));
  let scheduler:CoordinationScheduler|undefined;
  try{
   const {run,producer,worker}=fixture();producer.status='pending';producer.attempt=0;producer.requiredCapabilities=['file.read'];worker.requiredCapabilities=['file.read'];worker.ownershipScopes=[];
   const store=new CoordinationStore(cwd);await store.save(run);
   let downstream='';let contextBuilds=0;
   scheduler=new CoordinationScheduler({cwd,daemonInstanceId:'test-owner',store,ownershipRegistry:new OwnershipRegistry(cwd),authorization:{evaluate:async()=>({status:'allowed'})} as never,configProvider:async()=>({permissions:{sessionMode:'bypass'}} as never),collaborationContextFactory:async()=>{contextBuilds++;return {api:{} as never,manifest:{} as never,contextSnapshot:{renderedText:'Additional producer finding'} as never};},executor:{execute:async(assignment,context)=>{
    if(assignment.id===producer.id)return {outcome:'success',summary:'Bola Tinubu; APC; 29 May 2023; https://example.org/president'};
    downstream=taskForWorker(assignment,context.sessionId,cwd,context).prompt;return {outcome:'success',summary:'report'};
   }}});
   await scheduler.runUntilIdle(run.id,{pollIntervalMs:1,maxIdleTicks:10});
   expect((await store.load(run.id))?.workers.map(w=>({id:w.id,status:w.status,error:w.error}))).toEqual([{id:producer.id,status:'completed',error:undefined},{id:worker.id,status:'completed',error:undefined}]);
   expect(downstream).toContain('Nigeria');expect(downstream).toContain('Bola Tinubu');expect(downstream).toContain('https://example.org/president');expect(downstream).toContain('"attempt":1');
   expect(downstream).toContain('Additional producer finding');expect(contextBuilds).toBe(1);
  }finally{scheduler?.shutdown();await removeWorkspace(cwd);}
 });
 it('passes original objective and validated findings into actual child task',async()=>{
  const cwd=await mkdtemp(join(tmpdir(),'alix-worker-context-'));
  try {
   const {run,producer,worker}=fixture();const store=new CoordinationResultStore(cwd);
   producer.resultRef=await store.persist(producer,run.id,{outcome:'success',summary:'Bola Tinubu; APC; took office 29 May 2023. https://example.org/president'});
   const dependencyResults=await loadWorkerDependencyResults(run,worker,store);
   const context={run,cwd,sessionId:run.sessionId,config:{} as never,dependencyResults};
   const task=taskForWorker(worker,run.sessionId,cwd,context);
   expect(task.prompt).toContain('Nigeria');expect(task.prompt).toContain('Bola Tinubu');expect(task.prompt).toContain('https://example.org/president');expect(task.prompt).toContain('untrusted');expect(task.prompt).toContain('docs/report.md');
   expect(renderWorkerExecutionPrompt(worker,context)).toContain('Original coordination objective');
  }finally{await removeWorkspace(cwd);}
 });
 it.each(['runId','workerId','agentId','attempt'] as const)('rejects mismatched result %s',async(field)=>{
  const {run,producer,worker}=fixture();producer.resultRef='.alix/coordination/results/research.json';
  const record={schemaVersion:'1.0' as const,runId:run.id,workerId:producer.id,agentId:producer.agentId,attempt:producer.attempt,outcome:'success' as const,completedAt:new Date().toISOString(),summary:'WRONG RECORD',[field]:field==='attempt'?1:'other'};
  const results=await loadWorkerDependencyResults(run,worker,{loadByRef:async()=>({status:'ok' as const,record})});
  expect(results[0].warning).toContain('identity');expect(results[0].record).toBeUndefined();
 });
 it('bounds dependency data and preserves explicit missing-results warnings',async()=>{
  const {run,worker}=fixture();
  const results=await loadWorkerDependencyResults(run,worker,{loadByRef:async()=>({status:'missing' as const,message:'missing'})});
  const prompt=renderWorkerExecutionPrompt(worker,{run,sessionId:run.sessionId,cwd:'.',config:{} as never,dependencyResults:results});
  expect(prompt).toContain('no result reference');expect(prompt).toContain('Do not invent missing findings');
 });
 it('caps oversized findings without swallowing uncertainty or source identifiers',()=>{
  const {run,producer,worker}=fixture();
  const record={schemaVersion:'1.0' as const,runId:run.id,workerId:producer.id,agentId:producer.agentId,attempt:producer.attempt,outcome:'failure' as const,completedAt:new Date().toISOString(),summary:'x'.repeat(100_000),error:'Sources could not be verified'};
  const prompt=renderWorkerExecutionPrompt(worker,{run,sessionId:run.sessionId,cwd:'.',config:{} as never,dependencyResults:[{workerId:producer.id,taskLabel:producer.taskLabel,attempt:producer.attempt,record}]});
  expect(prompt.length).toBeLessThan(12_000);expect(prompt).toContain('truncated');expect(prompt).toContain('Sources could not be verified');expect(prompt).toContain('"outcome":"failure"');
 });
});
