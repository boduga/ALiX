/** GE-04 R2F qualification-only kernel/cgroup consistency probe.
 * Read-only observations with before/after identity checks. This is NOT a
 * privileged verifier: pathname races and fake caller-provided expected inode
 * remain possible. Results are never usable to clear custody or authorize work.
 */
import {lstatSync,readFileSync} from 'node:fs';
import type {RecoveryRecord} from './worker-supervisor-recovery-ledger.js';
import {observeKernelRecovery} from './worker-supervisor-kernel-recovery-observer.js';

export type KernelPin=Readonly<{dev:bigint;ino:bigint;uid:number;mode:number;isDirectory:boolean;isSymbolicLink:boolean}>;
export type RecoveryProbeAccess=Readonly<{
 inspect:(path:string)=>KernelPin;
 read:(path:string)=>string;
}>;
const hostAccess:RecoveryProbeAccess=Object.freeze({
 inspect:(path:string)=>{const s=lstatSync(path,{bigint:true});return {dev:s.dev,ino:s.ino,uid:Number(s.uid),mode:Number(s.mode),isDirectory:s.isDirectory(),isSymbolicLink:s.isSymbolicLink()};},
 read:(path:string)=>readFileSync(path,'utf8'),
});
export type PinnedRecoveryProbe=Readonly<{
 registrationId:string;
 status:'blocked';
 processState:'matching'|'different'|'absent'|'unknown';
 cgroupPopulated:'yes'|'no'|'unknown';
 cgroupPinStable:boolean;
 reasons:readonly string[];
}>;
function samePin(a:KernelPin,b:KernelPin):boolean {
 return a.dev===b.dev&&a.ino===b.ino&&a.uid===b.uid&&a.mode===b.mode&&a.isDirectory===b.isDirectory&&a.isSymbolicLink===b.isSymbolicLink;
}
/** Do not let a caller control the trust decision by merely supplying a pin.
 * An external privileged owner must attest the expected pin independently.
 * Even with matching pins, all results here remain BLOCKED.
 */
export function probePinnedRecovery(
 record:RecoveryRecord,leaf:string,expected:Readonly<{dev:bigint;ino:bigint}>,
 access:RecoveryProbeAccess=hostAccess,
):PinnedRecoveryProbe {
 if(process.platform!=='linux'||typeof leaf!=='string'||
    !leaf.startsWith('/sys/fs/cgroup/')||leaf.includes('\0')||
    leaf.slice(1).split('/').some(x=>x==='.'||x==='..'||x==='')||
    !expected||typeof expected.dev!=='bigint'||typeof expected.ino!=='bigint'||
    expected.dev<0n||expected.ino<=0n)
  throw new Error('WorkerSupervisor SECURITY HOLD: invalid pinned recovery target');
 const reasons:string[]=[];
 let first:KernelPin|undefined,second:KernelPin|undefined;
 try {first=access.inspect(leaf);}catch{reasons.push('cgroup identity unreadable before observation');}
 const observation=observeKernelRecovery(record,leaf+'/cgroup.events',{read:access.read});
 try {second=access.inspect(leaf);}catch{reasons.push('cgroup identity unreadable after observation');}
 const stable=!!first&&!!second&&samePin(first,second)&&
   first.isDirectory&&!first.isSymbolicLink&&
   first.uid===0&&first.dev===expected.dev&&first.ino===expected.ino;
 if(!stable)reasons.push('cgroup identity not pinned or changed');
 if(observation.processState==='matching')reasons.push('recorded process generation still exists');
 if(observation.processState==='unknown')reasons.push('process identity unknown');
 if(observation.cgroupPopulated!=='no')reasons.push('cgroup is populated or unreadable');
 reasons.push('independent privileged custody and descendant proof still required');
 return Object.freeze({registrationId:record.registrationId,status:'blocked' as const,
  processState:observation.processState,cgroupPopulated:observation.cgroupPopulated,
  cgroupPinStable:stable,reasons:Object.freeze(reasons)});
}
