/** GE-04 R1-B1 parent-side stop/attach/verify/resume qualification protocol.
 * This orchestration primitive is NOT production-wired. The trusted native
 * supervisor must supply pidfd-fenced operations and exclusive cgroup ownership.
 */
import type {WorkerCgroupV2} from './worker-supervisor-cgroup-v2.js';

export type StoppedChildIdentity=Readonly<{pid:number;startTimeTicks:string;state:'T'}>;
export type StopAttachProcess=Readonly<{
 pid:number;
 /** Must read kernel process state and starttime; never trust child output. */
 observe:()=>Promise<StoppedChildIdentity|null>;
 /** Native implementation MUST use pidfd or equivalent generation fencing. */
 resume:()=>Promise<void>;
 /** Must kill/reap the pinned process and any contained descendants. */
 terminate:()=>Promise<void>;
}>;
export type StopAttachCgroup=Pick<WorkerCgroupV2,'attachStoppedChild'|'killTree'|'assertEmpty'>;

/** A parent may resume only after two matching stopped observations and
 * successful cgroup membership verification. Any uncertainty leaves launch
 * denied and attempts cleanup, never treating cleanup as proof of safety.
 */
export async function stopAttachVerifyResume(
 child:StopAttachProcess,cgroup:StopAttachCgroup,
):Promise<StoppedChildIdentity>{
 if(!Number.isSafeInteger(child?.pid)||child.pid<=1)
  throw new Error('GE-04 invalid stopped child PID');
 try{
  const before=await child.observe();
  if(!before||before.pid!==child.pid||before.state!=='T'||
     !/^[1-9][0-9]*$/.test(before.startTimeTicks))
   throw new Error('GE-04 SECURITY HOLD: launcher not independently stopped');
  cgroup.attachStoppedChild(child.pid);
  const after=await child.observe();
  if(!after||after.pid!==before.pid||after.state!=='T'||
     after.startTimeTicks!==before.startTimeTicks)
   throw new Error('GE-04 SECURITY HOLD: stopped process generation changed');
  await child.resume();
  return after;
 }catch(error){
  // Attempt both cleanup actions even when one fails. An unresolved durable
  // intent must remain until independent process-tree containment is proven.
  try{cgroup.killTree();}catch{/* leave durable intent unresolved */}
  try{await child.terminate();}catch{/* leave durable intent unresolved */}
  throw error;
 }
}
