/** GE-04 R1-B1: root-only native launcher backend qualification prototype.
 * NOT production admission: path replacement, crash recovery, process-tree
 * confinement and broker IPC require independent security qualification.
 */
import {spawn} from 'node:child_process';
import {closeSync} from 'node:fs';
import {assertTrustedPeercredHelper,openPinnedPeercredHelper} from './worker-broker-trusted-helper.js';
import {readLinuxProcessIdentity} from './worker-broker-linux-process.js';
import type {TrustedLinuxLaunchBackend,NativeIsolatedWorker} from './worker-supervisor-linux.js';

export type NativeLaunchSelection=Readonly<{uid:number;executable:string;argument:string}>;
export type NativeLaunchBackendOptions=Readonly<{
  launcherPath:string;
  /** Deny-only containment request. This backend has no trusted pidfd/cgroup
   * implementation; never silently fall back to the uncontained launch. */
  requireKernelContainment?:boolean;
  /** Trusted supervisor-side projection; never accept paths or UIDs from worker messages. */
  selections:ReadonlyMap<string,NativeLaunchSelection>;
}>;

export function createNativeLauncherQualificationBackend(options:NativeLaunchBackendOptions):TrustedLinuxLaunchBackend {
  if(process.platform!=='linux'||process.getuid?.()!==0||process.geteuid?.()!==0)
    throw new Error('WorkerSupervisor native backend requires trusted root supervisor');
  if(options.requireKernelContainment)
    throw new Error('WorkerSupervisor SECURITY HOLD: kernel containment backend unavailable');
  assertTrustedPeercredHelper(options.launcherPath);
  return Object.freeze({
    async launch(request):Promise<NativeIsolatedWorker>{
      const selected=options.selections.get(request.configurationId);
      if(!selected||!Number.isSafeInteger(selected.uid)||selected.uid<1||selected.uid>0xffffffff||
         selected.uid===process.getuid?.()||typeof selected.executable!=='string'||
         !selected.executable.startsWith('/')||selected.executable.includes('\0')||
         typeof selected.argument!=='string'||selected.argument.includes('\0')||
         typeof request.workspaceRoot!=='string'||!request.workspaceRoot.startsWith('/')||
         request.workspaceRoot.includes('\0'))
        throw new Error('WorkerSupervisor launch selection not authorized');
      // Pin the qualified launcher inode before spawn. Child FD 4 references
      // that same inode, so renaming/replacing the pathname after preflight
      // cannot redirect exec to a different file. The trusted deployment
      // must still prevent modification of the pinned inode itself.
      const pinned=openPinnedPeercredHelper(options.launcherPath);
      let child;
      try{
        child=spawn('/proc/self/fd/4',[String(selected.uid),request.workspaceRoot,
          selected.executable,selected.argument],{
          detached:true,stdio:['ignore','ignore','pipe','ignore',pinned],
          env:{PATH:'/usr/bin:/bin'},
        });
      }finally{closeSync(pinned);}
      let exited=false;
      // The child can emit an error before procfs qualification finishes.
      // Retain the rejection as a handled result until the launch path awaits it.
      const exit=new Promise<Readonly<{exitCode:number|null;signal:string|null}>>((resolve,reject)=>{
        child.once('error',error=>{exited=true;reject(error);});
        child.once('exit',(code,signal)=>{exited=true;resolve({exitCode:code,signal});});
      });
      void exit.catch(()=>{});
      // Observe kernel identity; never take UID/starttime from child stdout.
      // A launch failure may race with procfs observation: kill and reap it.
      const pid=child.pid;
      try{
        if(!Number.isSafeInteger(pid)||!pid||pid<1)throw new Error('Native launcher PID unavailable');
        let observed=await readLinuxProcessIdentity(pid);
        for(let n=0;n<20 && observed?.uid!==selected.uid && !exited;n++){
          await new Promise<void>(resolve=>setTimeout(resolve,10));
          observed=await readLinuxProcessIdentity(pid);
        }
        if(!observed||observed.uid!==selected.uid||exited)
          throw new Error('Native launcher did not establish isolated UID');
        const terminate=async():Promise<void>=>{
          if(!exited){
            // The child is a detached session leader; signal its process group.
            try{process.kill(-pid,'SIGKILL');}
            catch(err){if((err as NodeJS.ErrnoException).code!=='ESRCH')throw err;}
          }
          await exit;
        };
        return Object.freeze({pid,uid:observed.uid,startTimeTicks:observed.startTimeTicks,
          terminate,wait:()=>exit});
      }catch(error){
        if(pid && !exited){try{process.kill(-pid,'SIGKILL');}catch{/* unqualified launch */}}
        await exit.catch(()=>{});
        throw error;
      }
    },
  });
}
