import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SubagentManager} from '../../src/agents/subagent-manager.js';
import {createLinuxWorkerLifecycle} from '../../src/agents/worker-ge04-linux-lifecycle.js';
import type {AlixConfig,SubagentTask} from '../../src/operations/config/schema.js';
const config={subagents:{enabled:true,roles:[{role:'explorer',mode:'read_only',style:'fast',retryCount:0}]},models:{default:{provider:'ollama',name:'llama3.2:3b'},fast:{provider:'ollama',name:'llama3.2:3b'}},apiKeys:{openai:'GE04_SECRET_MUST_NOT_CROSS'}} as unknown as AlixConfig;
const task={id:'real-ge04',role:'explorer',mode:'read_only',prompt:'probe',coordinationRunId:'coord-real',coordinationWorkerAttempt:3} as SubagentTask;
const childCode=`const fs=require('fs');let gate='';try{gate=fs.readFileSync(4,'utf8')}catch{};let credential='';try{credential=fs.readFileSync(3,'utf8')}catch{};console.log(JSON.stringify({gate,credential}));process.exit(gate==='WORKER_READY\\n' && credential==='{}'?0:41)`;
const run=(name:string,fn:()=>Promise<void>)=>test(name,{skip:process.platform!=='linux'},fn);
run('real Linux PID/procfs registration releases cooperative gate without credential payload',async()=>{
 const cwd=mkdtempSync(join(tmpdir(),'ge04-real-'));
 const registry=createLinuxWorkerLifecycle();
 let registeredPid=0;
 const manager=new SubagentManager({sessionId:'ge04',cwd,config,spawnOverride:{command:process.execPath,args:['-e',childCode]},workerLifecycle:{
  onSpawned:async id=>{await registry.onSpawned(id);registeredPid=id.pid;const resolved=await registry.resolveAttestedPeer({pid:id.pid,uid:id.uid,transport:'unix-peer-credentials'});assert.deepEqual(resolved,{coordinationRunId:'coord-real',workerId:'real-ge04',attempt:3});},
  onExited:pid=>registry.onExited(pid),
 }});
 try {
  const result=await manager.spawn(task);
  assert.ok(registeredPid>0);
  assert.notEqual(result.status,'failed');
  await assert.rejects(registry.resolveAttestedPeer({pid:registeredPid,uid:process.getuid!(),transport:'unix-peer-credentials'}));
 } finally {manager.shutdown();rmSync(cwd,{recursive:true,force:true});}
});
run('registration failure never releases real child gate',async()=>{
 const cwd=mkdtempSync(join(tmpdir(),'ge04-denied-'));
 let started=false;
 const manager=new SubagentManager({sessionId:'ge04',cwd,config,spawnOverride:{command:process.execPath,args:['-e',childCode]},workerLifecycle:{
  onSpawned:async()=>{started=true;throw new Error('GE04_DENIED')},onExited:()=>{},
 }});
 try {
  await assert.rejects(manager.spawn(task));
  assert.equal(started,true);
 } finally {manager.shutdown();rmSync(cwd,{recursive:true,force:true});}
});
