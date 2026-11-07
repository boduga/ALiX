/** GE-04 R1-B1: credential-free Linux supervisor lifecycle adapter.
 *
 * The trusted native launcher is intentionally NOT supplied here. This module
 * only accepts a launch backend from the privileged supervisor composition
 * root, validates its independently observed identity, and revokes on failure.
 * Never wire this to direct same-UID child_process.spawn in production.
 */
import {randomUUID} from 'node:crypto';
import {readLinuxProcessIdentity} from './worker-broker-linux-process.js';
import type {BrokerProcessIdentity,ReadLiveProcessIdentity} from './worker-broker-live-peer-binding.js';
import type {WorkerGrantIdentity} from './worker-grant-binding.js';
import type {SupervisedWorkerHandle,SupervisedWorkerRequest,WorkerSupervisor} from './worker-supervisor.js';

export type NativeIsolatedWorker=Readonly<{
  pid:number;
  uid:number;
  /** Native launcher's observed kernel start time, not a worker claim. */
  startTimeTicks:string;
  /** Must terminate the entire isolated process group and reap the worker. */
  terminate:(reason:string)=>Promise<void>;
  wait:()=>Promise<Readonly<{exitCode:number|null;signal:string|null}>>;
}>;

export type TrustedLinuxLaunchBackend=Readonly<{
  /** This is a trusted supervisor-only capability, never passed to a worker. */
  launch:(request:SupervisedWorkerRequest)=>Promise<NativeIsolatedWorker>;
}>;

function identityKey(worker:WorkerGrantIdentity):string {
  if(!worker || typeof worker.coordinationRunId!=='string' || !worker.coordinationRunId ||
     typeof worker.workerId!=='string' || !worker.workerId ||
     !Number.isSafeInteger(worker.attempt) || worker.attempt<1)
    throw new Error('Invalid supervised worker identity');
  return JSON.stringify([worker.coordinationRunId,worker.workerId,worker.attempt]);
}

function sameProcess(a:BrokerProcessIdentity|undefined,b:NativeIsolatedWorker):boolean {
  return !!a && a.pid===b.pid && a.uid===b.uid && a.startTimeTicks===b.startTimeTicks;
}

/**
 * Lifecycle qualification adapter, NOT an OS isolation or IPC attestation
 * implementation. No credential admission, and no production backend provided.
 */
export function createLinuxWorkerSupervisor(
  backend:TrustedLinuxLaunchBackend,
  readProcess:ReadLiveProcessIdentity=readLinuxProcessIdentity,
):WorkerSupervisor {
  if(process.platform!=='linux' || typeof backend?.launch!=='function' || typeof readProcess!=='function')
    throw new Error('GE-04 requires a trusted Linux supervisor backend');
  const active=new Map<string,{native:NativeIsolatedWorker;registrationId:string;termination?:Promise<void>}>();
  const pending=new Set<string>();
  const revokeEntry=async(key:string,reason:string):Promise<void>=>{
    const entry=active.get(key);
    if(!entry)return;
    // Keep registration until termination is confirmed. Concurrent revoke
    // requests share the same operation; failure must remain retryable.
    if(entry.termination)return entry.termination;
    const operation=Promise.resolve().then(()=>entry.native.terminate(reason));
    entry.termination=operation;
    try {
      await operation;
      if(active.get(key)===entry)active.delete(key);
    }catch(error){
      if(entry.termination===operation)entry.termination=undefined;
      throw error;
    }
  };
  return Object.freeze({
    async launch(request:SupervisedWorkerRequest):Promise<SupervisedWorkerHandle> {
      const key=identityKey(request?.identity);
      if(typeof request.configurationId!=='string'||!request.configurationId ||
         typeof request.workspaceRoot!=='string'||!request.workspaceRoot.startsWith('/') ||
         request.workspaceRoot.includes('\0'))throw new Error('Invalid trusted worker launch request');
      if(active.has(key)||pending.has(key))throw new Error('Duplicate supervised worker attempt');
      pending.add(key);
      let native:NativeIsolatedWorker|undefined;
      try {
        native=await backend.launch(request);
        if(!Number.isSafeInteger(native?.pid)||native!.pid<1 ||
           !Number.isSafeInteger(native!.uid)||native!.uid<0 ||
           native!.uid===process.getuid?.() ||
           !/^[1-9][0-9]*$/.test(native!.startTimeTicks) ||
           typeof native!.terminate!=='function'||typeof native!.wait!=='function')
          throw new Error('Untrusted or same-UID worker launch evidence');
        const observed=await readProcess(native!.pid);
        if(!sameProcess(observed,native!))throw new Error('Worker launch process identity mismatch');
        const registrationId=randomUUID();
        active.set(key,{native:native!,registrationId});
        const evidence=Object.freeze({identity:Object.freeze({...request.identity}),pid:native!.pid,
          uid:native!.uid,startTimeTicks:native!.startTimeTicks,registrationId});
        const launched=native!;
        return Object.freeze({
          evidence,
          cancel:(reason:string)=>revokeEntry(key,reason),
          async wait(){
            // A rejected wait is not evidence of process exit. Retain the
            // registration so revoke/reconcile can still terminate the worker.
            const result=await launched.wait();
            const entry=active.get(key);
            if(entry?.registrationId===registrationId && !entry.termination)active.delete(key);
            return result;
          },
        });
      }catch(error){
        if(native)await native.terminate('GE-04 failed launch qualification').catch(()=>{});
        throw error;
      }finally{pending.delete(key);}
    },
    revoke:(identity:WorkerGrantIdentity)=>revokeEntry(identityKey(identity),'GE-04 worker revoked'),
    async reconcile():Promise<void>{
      for(const [key,entry] of active){
        const observed=await readProcess(entry.native.pid).catch(()=>undefined);
        if(!sameProcess(observed,entry.native))await revokeEntry(key,'GE-04 stale worker identity');
      }
    },
  });
}
