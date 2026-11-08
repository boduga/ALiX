import {expect,test,vi} from 'vitest';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCustodiedAdmissionCoordinator} from '../../src/agents/worker-supervisor-custodied-admission.js';
import type {LaunchIntent,RecoveryRecord} from '../../src/agents/worker-supervisor-recovery-ledger.js';
const identity={coordinationRunId:'run',workerId:'worker',attempt:1};
const request={identity,configurationId:'config',workspaceRoot:'/tmp'};
function fixture(){
 const intents:LaunchIntent[]=[];
 const records:RecoveryRecord[]=[];
 const native={launch:vi.fn(async()=>({evidence:{identity,pid:234,uid:20001,startTimeTicks:'44',registrationId:'native'},cancel:async()=>{},wait:async()=>({exitCode:0,signal:null})})),revoke:vi.fn(async()=>{}),reconcile:vi.fn(async()=>{})};
 const ledger={unresolved:()=>records,unresolvedIntents:()=>intents,beginLaunch:(intent:LaunchIntent)=>{intents.push(intent)},promoteLaunch:(record:RecoveryRecord)=>{intents.length=0;records.push(record)}};
 return {native,ledger,intents,records};
}
test('custody is acquired before admission and blocks second coordinator',async()=>{
 const root=mkdtempSync(join(tmpdir(),'ge04-bound-'));
 try{
  const f=fixture(),path=join(root,'custody');
  const first=createCustodiedAdmissionCoordinator(path,'owner-a',f.native,f.ledger);
  expect(JSON.parse(readFileSync(join(path,'owner.json'),'utf8')).ownerId).toBe('owner-a');
  expect(()=>createCustodiedAdmissionCoordinator(path,'owner-b',f.native,f.ledger)).toThrow(/custody already claimed/);
  await expect(first.launch(request)).rejects.toThrow(/not reconciled/);
  await first.reconcile();
  await first.launch(request);
  expect(f.native.launch).toHaveBeenCalledOnce();
  await expect(first.reconcile()).rejects.toThrow(/unresolved durable/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('unresolved ledger blocks admission even with a fresh custody claim',async()=>{
 const root=mkdtempSync(join(tmpdir(),'ge04-bound-'));
 try{
  const f=fixture();
  f.intents.push({worker:identity,registrationId:'unresolved',state:'launching'});
  const supervisor=createCustodiedAdmissionCoordinator(join(root,'custody'),'owner-a',f.native,f.ledger);
  await expect(supervisor.reconcile()).rejects.toThrow(/unresolved durable/);
  await expect(supervisor.launch(request)).rejects.toThrow(/not reconciled/);
  expect(f.native.launch).not.toHaveBeenCalled();
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('invalid dependencies do not claim custody',()=>{
 const root=mkdtempSync(join(tmpdir(),'ge04-bound-'));
 try{
  const f=fixture();
  expect(()=>createCustodiedAdmissionCoordinator(join(root,'custody'),'owner-a',undefined as never,f.ledger)).toThrow(/invalid custody-bound/);
  expect(()=>createCustodiedAdmissionCoordinator(join(root,'custody'),'owner-b',f.native,f.ledger)).not.toThrow();
 }finally{rmSync(root,{recursive:true,force:true});}
});
