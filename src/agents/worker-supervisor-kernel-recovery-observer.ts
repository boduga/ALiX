/** GE-04 R2E read-only Linux kernel observation for recovery review.
 * Never emits a complete RecoveryEvidence attestation. PID absence, a matching
 * procfs generation, and cgroup.events are not sufficient to prove containment.
 * No custody release, ledger clearance, or worker admission is possible here.
 */
import {readFileSync} from 'node:fs';
import type {RecoveryRecord} from './worker-supervisor-recovery-ledger.js';
export type KernelRecoveryObservation=Readonly<{
 registrationId:string;
 pid:number;
 processState:'matching'|'different'|'absent'|'unknown';
 cgroupPopulated:'yes'|'no'|'unknown';
 eligibleForRecovery:boolean;
 reasons:readonly string[];
}>;
export type KernelObservationReader=Readonly<{read:(path:string)=>string}>;
const hostReader:KernelObservationReader={read:path=>readFileSync(path,'utf8')};
function parseStartTime(stat:string):string|undefined {
 const end=stat.lastIndexOf(')');
 if(end<0||stat[end+1]!==' ')return undefined;
 const fields=stat.slice(end+2).trim().split(/\s+/);
 // proc stat field 22, indexed from field 3 after the closing comm.
 const value=fields[19];
 return value&&/^[1-9][0-9]*$/.test(value)?value:undefined;
}
export function observeKernelRecovery(
 record:RecoveryRecord,cgroupEventsPath:string,reader:KernelObservationReader=hostReader,
):KernelRecoveryObservation {
 if(process.platform!=='linux'||!record?.process||
  !Number.isSafeInteger(record.process.pid)||record.process.pid<2||
  !/^[1-9][0-9]*$/.test(record.process.startTimeTicks)||
  typeof record.registrationId!=='string'||!record.registrationId||
  typeof cgroupEventsPath!=='string'||!cgroupEventsPath.startsWith('/sys/fs/cgroup/')||
  !cgroupEventsPath.endsWith('/cgroup.events')||
  cgroupEventsPath.split('/').some(x=>x==='..'||x==='.')||
  cgroupEventsPath.includes('\0'))
  throw new Error('WorkerSupervisor SECURITY HOLD: invalid kernel observation request');
 const reasons:string[]=[];
 let processState:KernelRecoveryObservation['processState']='unknown';
 try {
  const stat=reader.read('/proc/'+record.process.pid+'/stat');
  const start=parseStartTime(stat);
  processState=start===undefined?'unknown':start===record.process.startTimeTicks?'matching':'different';
 }catch(error){
  // Only ENOENT indicates absent procfs entry. Other errors are unknown.
  processState=(error as NodeJS.ErrnoException)?.code==='ENOENT'?'absent':'unknown';
 }
 let cgroupPopulated:KernelRecoveryObservation['cgroupPopulated']='unknown';
 try {
  const contents=reader.read(cgroupEventsPath);
  const states=[...contents.matchAll(/^populated\s+([01])\s*$/gm)];
  if(states.length===1)cgroupPopulated=states[0]![1]==='1'?'yes':'no';
 }catch{/* fail closed */}
 reasons.push('kernel observation alone cannot establish exclusive containment or recovery authority');
 if(processState==='matching')reasons.push('recorded process generation remains present');
 if(processState==='unknown')reasons.push('process generation cannot be verified');
 if(cgroupPopulated==='yes')reasons.push('cgroup remains populated');
 if(cgroupPopulated==='unknown')reasons.push('cgroup populated state cannot be verified');
 return Object.freeze({registrationId:record.registrationId,pid:record.process.pid,
  processState,cgroupPopulated,eligibleForRecovery:false,reasons:Object.freeze(reasons)});
}
