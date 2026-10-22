import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventLog } from '../../src/runtime-state/events/event-log.js';
import { captureWorkerEventLog, reviewDefaultWorkerResult } from '../../src/coordination/kernel/default-worker-review.js';
import { DefaultWorkerExecutor } from '../../src/coordination/kernel/worker-executor.js';
import { createCoordinationRun, createWorkerAssignment } from '../../src/coordination/kernel/coordination-types.js';
import { DEFAULT_CONFIG } from '../../src/operations/config/defaults.js';
import { closeAllSharedLedgers } from '../../src/runtime-state/storage/runtime-ledger.js';
import { loadApprovalStore } from '../../src/governance/approvals/approval-store.js';
import type { AlixConfig } from '../../src/operations/config/schema.js';

const mocks=vi.hoisted(()=>({complete:vi.fn(),runTask:vi.fn()}));
vi.mock('../../src/models/providers/registry.js',()=>({createProvider:async()=>({complete:mocks.complete})}));
vi.mock('../../src/governance/security/credentials/api-keys.js',()=>({getApiKey:async()=>undefined}));
vi.mock('../../src/run.js',()=>({runTask:mocks.runTask}));
afterEach(()=>vi.clearAllMocks());
async function fixture(){
 const cwd=await mkdtemp(join(tmpdir(),'alix-default-review-'));const log=new EventLog(join(cwd,'.alix','sessions','session'));await log.init();
 const run=createCoordinationRun({sessionId:'session',rootGoal:'Write report about president of Nigeria.',coordinatorAgentId:'parent'});
 const worker=createWorkerAssignment({coordinationRunId:run.id,agentId:'writer',taskLabel:'Report',goalPrompt:'Write president report',requiredCapabilities:['file.create'],ownershipScopes:['reports/']});run.workers=[worker];
 const config: AlixConfig={...DEFAULT_CONFIG,models:{default:{provider:'mock',name:'mock'}},permissions:{...DEFAULT_CONFIG.permissions,sessionMode:'bypass'}};
 return {cwd,log,run,worker,context:{cwd,run,sessionId:run.sessionId,config}};
}
describe('default worker review',()=>{
 it.each([
  {label:'default ask',defaultPolicy:'ask',readPolicy:undefined,protectedPath:false,success:true},
  {label:'explicit ask',defaultPolicy:'allow',readPolicy:'ask',protectedPath:false,success:true},
  {label:'explicit allow over default deny',defaultPolicy:'deny',readPolicy:'allow',protectedPath:false,success:true},
  {label:'explicit deny',defaultPolicy:'allow',readPolicy:'deny',protectedPath:false,success:false},
  {label:'default deny',defaultPolicy:'deny',readPolicy:undefined,protectedPath:false,success:false},
  {label:'protected path',defaultPolicy:'ask',readPolicy:'allow',protectedPath:true,success:false},
 ] as const)('review read parity: $label',async({defaultPolicy,readPolicy,protectedPath,success})=>{
  const {cwd,log,worker,context}=await fixture();try{
   context.config.permissions={...context.config.permissions,sessionMode:'ask',default:defaultPolicy,
    tools:readPolicy?{'file.read':readPolicy}:{},protectedPaths:protectedPath?['reports/**']:[]};
   await mkdir(join(cwd,'reports'),{recursive:true});
   await writeFile(join(cwd,'reports','report.md'),'Nigeria report');
   const event=await log.append({sessionId:'session',actor:'tool',type:'file.created',payload:{path:'reports/report.md'}});
   mocks.complete.mockResolvedValue({text:JSON.stringify({satisfied:true,summary:'Correct report',gaps:[]}),toolCalls:[]});
   const result=await reviewDefaultWorkerResult(worker,context,{sessionId:'session',summary:'Done',reason:'completed'},[event],log,new AbortController().signal);
   expect(result.outcome).toBe(success?'success':'failure');
   expect(mocks.complete).toHaveBeenCalledTimes(success?1:0);
   expect((await loadApprovalStore(cwd))?.listPending()).toEqual([]);
   expect(context.config.permissions.tools).toEqual(readPolicy?{'file.read':readPolicy}:{});
  }finally{closeAllSharedLedgers();await rm(cwd,{recursive:true,force:true});}
 });
  it('reviews only owned outputs when supplied sibling mutation events',async()=>{
  const {cwd,log,worker,context}=await fixture();try{
   await mkdir(join(cwd,'reports'),{recursive:true});
   await writeFile(join(cwd,'reports','report.md'),'Nigeria report');
   worker.ownershipScopes=['reports/report.md'];
   const events=[];
   for(const path of ['reports/a.md','reports/report.md','reports/c.md']) events.push(await log.append({sessionId:'session',actor:'tool',type:'file.created',payload:{path}}));
   mocks.complete.mockImplementation(async request=>{
    const evidence=JSON.parse(request.messages[0].content);
    expect(evidence.persistedOutputs.map((item:{path:string})=>item.path)).toEqual(['reports/report.md']);
    return {text:JSON.stringify({satisfied:true,summary:'Correct report',gaps:[]}),toolCalls:[]};
   });
   const result=await reviewDefaultWorkerResult(worker,context,{sessionId:'session',summary:'Done',reason:'completed'},events,log,new AbortController().signal);
   expect(result.outcome).toBe('success');expect(mocks.complete).toHaveBeenCalledOnce();
  }finally{closeAllSharedLedgers();await rm(cwd,{recursive:true,force:true});}
 });
  it('keeps an earlier attempt\'s durable evidence when the retry mutates nothing',async()=>{
   const {cwd,log,worker,context}=await fixture();try{
    await mkdir(join(cwd,'reports'),{recursive:true});
    await writeFile(join(cwd,'reports','report.md'),'Nigeria report');
    worker.ownershipScopes=['reports/report.md'];
    // An EARLIER attempt of this worker wrote the deliverable. The session log
    // is durable, so the retry keeps the proof even though re-creating
    // identical content emits no mutation event at all.
    await log.append({sessionId:'session',actor:'tool',type:'file.created',payload:{path:'reports/report.md'}});
    mocks.complete.mockImplementation(async request=>{
     const evidence=JSON.parse(request.messages[0].content);
     expect(evidence.persistedOutputs.map((item:{path:string})=>item.path)).toEqual(['reports/report.md']);
     return {text:JSON.stringify({satisfied:true,summary:'Correct report',gaps:[]}),toolCalls:[]};
    });
    // The retry itself produced NO mutation event: the deliverable already exists.
    const result=await reviewDefaultWorkerResult(worker,context,{sessionId:'session',summary:'Done',reason:'completed'},[],log,new AbortController().signal);
    expect(result.outcome).toBe('success');expect(mocks.complete).toHaveBeenCalledOnce();
   }finally{closeAllSharedLedgers();await rm(cwd,{recursive:true,force:true});}
  });
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
 it('passes scheduler-owned write paths to the in-process runTask boundary',async()=>{
  const {cwd,worker,context}=await fixture();try{
   worker.ownershipClaims=[{path:'reports/president.md',recursive:false}];
   worker.ownershipScopes=['reports/'];
   mocks.runTask.mockResolvedValue({sessionId:'session',summary:'Done',reason:'completed'});
   mocks.complete.mockResolvedValue({text:JSON.stringify({satisfied:true,summary:'Done',gaps:[]}),toolCalls:[]});
   await new DefaultWorkerExecutor().execute(worker,context,new AbortController().signal);
   expect(mocks.runTask.mock.calls[0][2].ownedPaths).toEqual(['reports/president.md','reports/']);
  }finally{closeAllSharedLedgers();await rm(cwd,{recursive:true,force:true});}
 });
 it('does not add ownership context to read-only workers',async()=>{
  const {cwd,worker,context}=await fixture();try{
   worker.requiredCapabilities=['web.search'];
   worker.ownershipScopes=['reports/'];
   mocks.runTask.mockResolvedValue({sessionId:'session',summary:'Done',reason:'completed'});
   mocks.complete.mockResolvedValue({text:JSON.stringify({satisfied:true,summary:'Done',gaps:[]}),toolCalls:[]});
   await new DefaultWorkerExecutor().execute(worker,context,new AbortController().signal);
   expect(mocks.runTask.mock.calls[0][2]).not.toHaveProperty('ownedPaths');
  }finally{closeAllSharedLedgers();await rm(cwd,{recursive:true,force:true});}
 });
 it('fails closed before runTask when write ownership is missing or malformed',async()=>{
  const {cwd,worker,context}=await fixture();try{
   worker.ownershipScopes=[''];
   const result=await new DefaultWorkerExecutor().execute(worker,context,new AbortController().signal);
   expect(result.outcome).toBe('failure');expect(result.failureKind).toBe('authorization_denied');
   expect(mocks.runTask).not.toHaveBeenCalled();
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
   // Write INSIDE the worker's owned scope. The fixture assigns
   // ownershipScopes ['reports/'], and the review is now scoped to owned paths —
   // a write at cwd root would be an ownership violation and correctly excluded
   // from the deliverable set, so the old path no longer exercised this case.
   await mkdir(join(cwd,'reports'),{recursive:true});
   await writeFile(join(cwd,'reports','report.md'),'Donald Trump is US president.');const capture=captureWorkerEventLog(log);
   await capture.log.append({sessionId:'session',actor:'tool',type:'file.created',payload:{path:'reports/report.md'}});
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
