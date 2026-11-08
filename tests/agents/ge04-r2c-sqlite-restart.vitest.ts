import {expect,test,vi} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {WorkerSupervisorRecoveryLedger} from '../../src/agents/worker-supervisor-recovery-ledger.js';
import {createCustodiedAdmissionCoordinator} from '../../src/agents/worker-supervisor-custodied-admission.js';
const identity={coordinationRunId:'run',workerId:'w',attempt:1};
const request={identity,configurationId:'config',workspaceRoot:'/tmp'};
function setup(){
 const dir=mkdtempSync(join(tmpdir(),'ge04-r2c-'));
 const db=join(dir,'ledger.db');writeFileSync(db,'',{mode:0o600});
 return {dir,db};
}
function backend(){
 return {launch:vi.fn(async()=>({evidence:{identity,pid:432,uid:20002,startTimeTicks:'123',registrationId:'native'},cancel:async()=>{},wait:async()=>({exitCode:0,signal:null})})),
 revoke:vi.fn(async()=>{}),reconcile:vi.fn(async()=>{})};
}
test.skipIf(process.platform!=='linux')('real sqlite ledger persists promoted registration and blocks replacement',async()=>{
 const {dir,db}=setup();
 try{
  let ledger=new WorkerSupervisorRecoveryLedger(db);const native=backend();
  const supervisor=createCustodiedAdmissionCoordinator(join(dir,'claim-a'),'owner-a',native,ledger);
  await supervisor.reconcile();await supervisor.launch(request);
  expect(ledger.unresolved()).toHaveLength(1);
  ledger.close();ledger=new WorkerSupervisorRecoveryLedger(db);
  const replacement=backend();
  const other=createCustodiedAdmissionCoordinator(join(dir,'claim-b'),'owner-b',replacement,ledger);
  await expect(other.reconcile()).rejects.toThrow(/unresolved durable/);
  await expect(other.launch(request)).rejects.toThrow(/not reconciled/);
  expect(replacement.launch).not.toHaveBeenCalled();
  ledger.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test.skipIf(process.platform!=='linux')('unknown launch outcome survives sqlite reopen and denies restart',async()=>{
 const {dir,db}=setup();
 try{
  let ledger=new WorkerSupervisorRecoveryLedger(db);const native=backend();
  native.launch.mockRejectedValueOnce(new Error('spawn unknown'));
  const supervisor=createCustodiedAdmissionCoordinator(join(dir,'claim-a'),'owner-a',native,ledger);
  await supervisor.reconcile();
  await expect(supervisor.launch(request)).rejects.toThrow('spawn unknown');
  expect(ledger.unresolvedIntents()).toHaveLength(1);
  ledger.close();ledger=new WorkerSupervisorRecoveryLedger(db);
  const other=createCustodiedAdmissionCoordinator(join(dir,'claim-b'),'owner-b',backend(),ledger);
  await expect(other.reconcile()).rejects.toThrow(/unresolved durable/);
  ledger.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test.skipIf(process.platform!=='linux')('separate process writes intent and exits; restart retains it and sticky custody',async()=>{
 const {dir,db}=setup();
 try{
  const claim=join(dir,'claim');
  const child=spawnSync(process.execPath,['-e',`
   const fs=require('node:fs');const path=require('node:path');
   const Database=require('better-sqlite3');
   fs.mkdirSync(process.argv[2],{mode:0o700});
   fs.writeFileSync(path.join(process.argv[2],'owner.json'),JSON.stringify({ownerId:'child'}),{mode:0o600,flag:'wx'});
   const db=new Database(process.argv[1]);db.pragma('journal_mode = WAL');db.pragma('synchronous = FULL');
   db.exec("CREATE TABLE IF NOT EXISTS launch_intents (identity TEXT PRIMARY KEY, registration_id TEXT NOT NULL, state TEXT NOT NULL CHECK(state='launching'))");
   db.prepare('INSERT INTO launch_intents(identity,registration_id,state) VALUES (?,?,?)').run(JSON.stringify(['run','w',1]),'crash-reg','launching');
   process.exit(17);
  `,db,claim],{cwd:process.cwd(),timeout:5000});
  expect(child.status).toBe(17);
  const ledger=new WorkerSupervisorRecoveryLedger(db);
  expect(ledger.unresolvedIntents()).toMatchObject([{registrationId:'crash-reg'}]);
  expect(JSON.parse(readFileSync(join(claim,'owner.json'),'utf8')).ownerId).toBe('child');
  expect(()=>createCustodiedAdmissionCoordinator(claim,'replacement',backend(),ledger)).toThrow(/custody already claimed/);
  const newClaim=createCustodiedAdmissionCoordinator(join(dir,'claim-new'),'replacement',backend(),ledger);
  await expect(newClaim.reconcile()).rejects.toThrow(/unresolved durable/);
  ledger.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
