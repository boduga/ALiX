/** GE-04 Q3.13: real CoordinationStore claim/ledger qualification; no route authority is persisted. */
import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CoordinationStore} from '../../src/coordination/kernel/coordination-store.js';
import {createCoordinationRun,createWorkerAssignment} from '../../src/coordination/kernel/coordination-types.js';
import {getSharedLedger,closeSharedLedger} from '../../src/runtime-state/storage/runtime-ledger.js';

async function fixture(prefix:string){
 const cwd=mkdtempSync(join(tmpdir(),prefix));
 const store=new CoordinationStore(cwd);
 const run=createCoordinationRun({sessionId:'ge04',rootGoal:'claim qualification',coordinatorAgentId:'alix'});
 await store.save(run);
 const worker=createWorkerAssignment({coordinationRunId:run.id,agentId:'worker',taskLabel:'qualification',goalPrompt:'synthetic',requiredCapabilities:['task.do'],attempt:0,maxAttempts:3});
 await store.addWorker(run.id,worker);
 return {cwd,store,run,worker,cleanup:()=>{closeSharedLedger(cwd);rmSync(cwd,{recursive:true,force:true});}};
}

describe('GE-04 Q3.13 actual CoordinationStore claim boundary',()=>{
 it('commits one authoritative claim under concurrent calls, with no losing ledger append',async()=>{
  const f=await fixture('ge04-q313-race-');try{
   const before=getSharedLedger(f.cwd).entityVersion(f.run.id);
   const results=await Promise.all(Array.from({length:8},(_,i)=>f.store.claimPendingWorker(f.run.id,f.worker.id,0,{executionOwnerId:`daemon-${i}`})));
   assert.equal(results.filter(Boolean).length,1);
   assert.equal(getSharedLedger(f.cwd).entityVersion(f.run.id),before+1);
   const loaded=await new CoordinationStore(f.cwd).load(f.run.id);
   assert.equal(loaded?.workers[0]?.status,'running');assert.equal(loaded?.workers[0]?.attempt,1);
  }finally{f.cleanup();}
 });
 it('replays committed claim from ledger when JSON projection fails',async()=>{
  const f=await fixture('ge04-q313-projection-');try{
   // A directory at the projection file path makes rename fail without blocking ledger append.
   const path=join(f.cwd,'.alix','coordination',`${f.run.id}.json`);
   rmSync(path,{force:true});mkdirSync(path);
   const before=getSharedLedger(f.cwd).entityVersion(f.run.id);
   assert.equal(await f.store.claimPendingWorker(f.run.id,f.worker.id,0,{executionOwnerId:'daemon'}),true);
   assert.equal(getSharedLedger(f.cwd).entityVersion(f.run.id),before+1);
   assert.ok(f.store.ledgerStatus().projectionFailures>0);
   const reloaded=await new CoordinationStore(f.cwd).load(f.run.id);
   assert.equal(reloaded?.workers[0]?.attempt,1);assert.equal(reloaded?.workers[0]?.executionOwnerId,'daemon');
  }finally{f.cleanup();}
 });
 it('rejects stale claim after plan update and never creates a route snapshot implicitly',async()=>{
  const f=await fixture('ge04-q313-replan-');try{
   const before=getSharedLedger(f.cwd).entityVersion(f.run.id);
   const changed=await f.store.updateRunWithRevisionCheck(f.run.id,f.run.planRevision,run=>{run.workers[0]!.status='cancelled';});
   assert.ok(changed);
   const after=getSharedLedger(f.cwd).entityVersion(f.run.id);
   assert.equal(after,before+1);
   assert.equal(await f.store.claimPendingWorker(f.run.id,f.worker.id,0,{executionOwnerId:'daemon'}),false);
   assert.equal(getSharedLedger(f.cwd).entityVersion(f.run.id),after);
   const loaded=await f.store.load(f.run.id);
   assert.equal(loaded?.workers[0]?.status,'cancelled');
   // The production claim does not contain a trusted route snapshot; do not treat it as authorized.
   assert.equal(Object.hasOwn(loaded?.workers[0]??{},'trustedRouteSnapshot'),false);
  }finally{f.cleanup();}
 });
});
