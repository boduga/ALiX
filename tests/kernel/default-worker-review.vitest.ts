import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventLog } from '../../src/runtime-state/events/event-log.js';
import { captureWorkerEventLog, reviewDefaultWorkerResult } from '../../src/coordination/kernel/default-worker-review.js';
import { DefaultWorkerExecutor } from '../../src/coordination/kernel/worker-executor.js';
import { createCoordinationRun, createWorkerAssignment } from '../../src/coordination/kernel/coordination-types.js';
import { DEFAULT_CONFIG } from '../../src/operations/config/defaults.js';
import { closeAllSharedLedgers } from '../../src/runtime-state/storage/runtime-ledger.js';

const mocks=vi.hoisted(()=>({complete:vi.fn(),runTask:vi.fn()}));
vi.mock('../../src/models/providers/registry.js',()=>({createProvider:async()=>({complete:mocks.complete})}));
vi.mock('../../src/operations/config/api-keys.js',()=>({getApiKey:async()=>undefined}));
vi.mock('../../src/run.js',()=>({runTask:mocks.runTask}));
afterEach(()=>vi.clearAllMocks());
async function fixture(){
 const cwd=await mkdtemp(join(tmpdir(),'alix-default-review-'));const log=new EventLog(join(cwd,'.alix','sessions','session'));await log.init();
 const run=createCoordinationRun({sessionId:'session',rootGoal:'Write report about president of Nigeria.',coordinatorAgentId:'parent'});
 const worker=createWorkerAssignment({coordinationRunId:run.id,agentId:'writer',taskLabel:'Report',goalPrompt:'Write president report',requiredCapabilities:['file.create']});run.workers=[worker];
 const config={...DEFAULT_CONFIG,models:{default:{provider:'mock',name:'mock'}},permissions:{...DEFAULT_CONFIG.permissions,sessionMode:'bypass' as const}};
 return {cwd,log,run,worker,context:{cwd,run,sessionId:run.sessionId,config}};
}
describe('default worker review',()=>{
 it('passes full successful tool evidence beyond the 200-character telemetry preview',async()=>{
  const {cwd,worker,context}=await fixture();try{
   worker.requiredCapabilities=['web.search'];
   const full='Background '.repeat(40)+'Bola Ahmed Tinubu; https://statehouse.gov.ng/';
   mocks.runTask.mockImplementation(async (_cwd,_prompt,opts)=>{
    opts.onToolResult('alix_web_search',full);
    await opts.sharedSession.eventLog.append({sessionId:'session',actor:'tool',type:'tool.output',payload:{toolCallId:'search',outputPreview:full.slice(0,200)}});
    return {sessionId:'session',summary:'Research complete',reason:'completed'};
   });
   mocks.complete.mockImplementation(async request=>{
    expect(JSON.stringify(request.messages)).toContain('https://statehouse.gov.ng/');
    return {text:JSON.stringify({satisfied:true,summary:'Nigeria: Bola Ahmed Tinubu; https://statehouse.gov.ng/',gaps:[]}),toolCalls:[]};
   });
   const result=await new DefaultWorkerExecutor().execute(worker,context,new AbortController().signal);
   expect(result.outcome).toBe('success');expect(result.summary).toContain('Bola Ahmed Tinubu');
  }finally{closeAllSharedLedgers();await rm(cwd,{recursive:true,force:true});}
 });
 it('captures each worker appends separately with one durable shared log',async()=>{
  const {cwd,log}=await fixture();try{
   const a=captureWorkerEventLog(log),b=captureWorkerEventLog(log);
   await Promise.all([a.log.append({sessionId:'session',actor:'tool',type:'file.created',payload:{path:'a.md'}}),b.log.append({sessionId:'session',actor:'tool',type:'file.created',payload:{path:'b.md'}})]);
   expect(a.events.map(e=>e.payload)).toEqual([{path:'a.md'}]);expect(b.events.map(e=>e.payload)).toEqual([{path:'b.md'}]);expect(await log.readAll()).toHaveLength(2);
  }finally{closeAllSharedLedgers();await rm(cwd,{recursive:true,force:true});}
 });
 it('rejects completed writer with persisted wrong-country artifact',async()=>{
  const {cwd,log,worker,context}=await fixture();try{
   await writeFile(join(cwd,'report.md'),'Donald Trump is US president.');const capture=captureWorkerEventLog(log);
   await capture.log.append({sessionId:'session',actor:'tool',type:'file.created',payload:{path:'report.md'}});
   mocks.complete.mockResolvedValue({text:JSON.stringify({satisfied:false,summary:'Wrong country',gaps:['Nigeria report required']}),toolCalls:[]});
   const result=await reviewDefaultWorkerResult(worker,context,{sessionId:'session',summary:'Done',reason:'completed'},capture.events,capture.log,new AbortController().signal);
   expect(result.outcome).toBe('failure');expect(result.error).toContain('Nigeria report required');expect(JSON.stringify(mocks.complete.mock.calls)).toContain('Donald Trump');expect(result.error).toContain('report.md');
  }finally{closeAllSharedLedgers();await rm(cwd,{recursive:true,force:true});}
 });
 it.each(['max_iterations','completed_unverified'] as const)('rejects runTask terminal reason %s before review',async(reason)=>{
  const {cwd,worker,context}=await fixture();try{
   mocks.runTask.mockResolvedValue({sessionId:'session',summary:'Not completed',reason});
   const signal=new AbortController().signal;const result=await new DefaultWorkerExecutor().execute(worker,context,signal);
   expect(result.outcome).toBe('failure');expect(result.error).toContain(reason);expect(mocks.complete).not.toHaveBeenCalled();expect(mocks.runTask.mock.calls[0][2].signal).toBe(signal);
  }finally{closeAllSharedLedgers();await rm(cwd,{recursive:true,force:true});}
 });
});
