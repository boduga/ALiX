/** GE-04 R1-B1: fail-closed durable recovery ledger prototype.
 * A record is an unresolved process ownership claim, NOT proof of liveness.
 * The privileged supervisor must reconcile it against kernel identity and
 * containment before admitting a replacement. No production wiring yet.
 */
import Database from 'better-sqlite3';
import {lstatSync} from 'node:fs';
import type {BrokerProcessIdentity} from './worker-broker-live-peer-binding.js';
import type {WorkerGrantIdentity} from './worker-grant-binding.js';

export type LaunchIntent=Readonly<{worker:WorkerGrantIdentity;registrationId:string;state:'launching'}>;
export type RecoveryRecord=Readonly<{worker:WorkerGrantIdentity;process:BrokerProcessIdentity;registrationId:string}>;
const key=(w:WorkerGrantIdentity)=>JSON.stringify([w.coordinationRunId,w.workerId,w.attempt]);
export class WorkerSupervisorRecoveryLedger {
 private readonly db:Database.Database;
 constructor(path:string){
  if(process.platform!=='linux'||typeof path!=='string'||!path.startsWith('/')||path.includes('\0'))
   throw new Error('WorkerSupervisor recovery ledger requires absolute Linux path');
  // A privileged deployment must additionally pin and validate directory
  // ancestry and enforce exclusive supervisor ownership before using this.
  this.db=new Database(path,{fileMustExist:true});
  const st=lstatSync(path);
  if(!st.isFile()||(st.mode&0o077)!==0||st.uid!==process.geteuid?.()){
   this.db.close();throw new Error('Untrusted WorkerSupervisor recovery ledger permissions');
  }
  this.db.pragma('journal_mode = WAL');
  this.db.pragma('synchronous = FULL');
  this.db.exec(`CREATE TABLE IF NOT EXISTS unresolved_workers (
   identity TEXT PRIMARY KEY, payload TEXT NOT NULL)`);
  this.db.exec(`CREATE TABLE IF NOT EXISTS launch_intents (
   identity TEXT PRIMARY KEY, registration_id TEXT NOT NULL, state TEXT NOT NULL CHECK(state='launching'))`);
 }
 /** Commit intent BEFORE native spawn. Unknown outcome must remain blocking. */
 beginLaunch(intent:LaunchIntent):void {
  const w=intent?.worker;
  if(!w||typeof w.coordinationRunId!=='string'||!w.coordinationRunId||
   typeof w.workerId!=='string'||!w.workerId||!Number.isSafeInteger(w.attempt)||w.attempt<1||
   typeof intent.registrationId!=='string'||!intent.registrationId||intent.state!=='launching')
   throw new Error('Invalid WorkerSupervisor launch intent');
  this.db.transaction(()=>{
   if(this.db.prepare('SELECT 1 FROM unresolved_workers WHERE identity=?').get(key(w)))
    throw new Error('WorkerSupervisor unresolved registration blocks launch intent');
   this.db.prepare('INSERT INTO launch_intents(identity,registration_id,state) VALUES (?,?,?)')
    .run(key(w),intent.registrationId,intent.state);
  })();
 }
 /** Atomic promotion after independently observed process qualification. */
 promoteLaunch(record:RecoveryRecord):void {
  this.db.transaction(()=>{
   const row=this.db.prepare('SELECT registration_id FROM launch_intents WHERE identity=?')
    .get(key(record.worker)) as {registration_id:string}|undefined;
   if(!row||row.registration_id!==record.registrationId)
    throw new Error('WorkerSupervisor launch intent registration mismatch');
   this.register(record);
   this.db.prepare('DELETE FROM launch_intents WHERE identity=? AND registration_id=?')
    .run(key(record.worker),record.registrationId);
  })();
 }
 unresolvedIntents():LaunchIntent[]{
  return this.db.prepare('SELECT identity,registration_id FROM launch_intents ORDER BY identity').all()
   .map(row=>{
    const r=row as {identity:string;registration_id:string};
    const [coordinationRunId,workerId,attempt]=JSON.parse(r.identity) as [string,string,number];
    return {worker:{coordinationRunId,workerId,attempt},registrationId:r.registration_id,state:'launching' as const};
   });
 }
 /** Only after externally verified no spawn occurred OR complete containment. */
 clearIntent(worker:WorkerGrantIdentity,registrationId:string):void {
  const result=this.db.prepare('DELETE FROM launch_intents WHERE identity=? AND registration_id=?')
   .run(key(worker),registrationId);
  if(result.changes!==1)throw new Error('WorkerSupervisor launch intent not cleared: registration mismatch');
 }
 register(record:RecoveryRecord):void {
  const w=record?.worker,p=record?.process;
  if(!w||!p||!w.coordinationRunId||!w.workerId||!Number.isSafeInteger(w.attempt)||w.attempt<1||
   !Number.isSafeInteger(p.pid)||p.pid<1||!Number.isSafeInteger(p.uid)||p.uid<1||
   !/^[1-9][0-9]*$/.test(p.startTimeTicks)||!record.registrationId)
   throw new Error('Invalid WorkerSupervisor recovery record');
  this.db.prepare('INSERT INTO unresolved_workers(identity,payload) VALUES (?,?)').run(key(w),JSON.stringify(record));
 }
 unresolved():RecoveryRecord[]{
  return this.db.prepare('SELECT payload FROM unresolved_workers ORDER BY identity').all()
   .map(row=>JSON.parse((row as {payload:string}).payload) as RecoveryRecord);
 }
 /** Only call after independent confirmation of termination and reaping. */
 clear(worker:WorkerGrantIdentity,registrationId:string):void {
  const result=this.db.prepare(`DELETE FROM unresolved_workers WHERE identity=? AND
   json_extract(payload,'$.registrationId')=?`).run(key(worker),registrationId);
  if(result.changes!==1)throw new Error('WorkerSupervisor recovery record not cleared: registration mismatch');
 }
 close():void{this.db.close();}
}
