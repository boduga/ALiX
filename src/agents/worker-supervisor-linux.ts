/** GE-04 R1-B1: credential-free Linux supervisor lifecycle adapter.
 *
 * The trusted native launcher is intentionally NOT supplied here. This module
 * only accepts a launch backend from the privileged supervisor composition
 * root, validates its independently observed identity, and revokes on failure.
 * Never wire this to direct same-UID child_process.spawn in production.
 */
import {randomUUID} from 'node:crypto';
import {isAbsolute, normalize, sep} from 'node:path';
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
    throw new Error('WorkerSupervisor requires a trusted Linux supervisor backend');
  const active=new Map<string,{native:NativeIsolatedWorker;registrationId:string;termination?:Promise<void>;waiting?:Promise<Readonly<{exitCode:number|null;signal:string|null}>>}>();
  type PendingLaunch={revoked:boolean;settled:Promise<void>;resolve:()=>void};
  const pending=new Map<string,PendingLaunch>();
  // A failed qualification cleanup may leave an untrusted child alive. Never
  // permit a replacement attempt until its termination is confirmed.
  const quarantined=new Map<string,{native:NativeIsolatedWorker;termination?:Promise<void>}>();
  const terminateQuarantined=async(key:string,reason:string):Promise<void>=>{
    const entry=quarantined.get(key);
    if(!entry)return;
    if(entry.termination)return entry.termination;
    const operation=Promise.resolve().then(()=>entry.native.terminate(reason));
    entry.termination=operation;
    try{
      await operation;
      if(quarantined.get(key)===entry)quarantined.delete(key);
    }catch(error){
      if(entry.termination===operation)entry.termination=undefined;
      throw error;
    }
  };
  const revokeEntry=async(key:string,reason:string,expectedRegistrationId?:string):Promise<void>=>{
    const entry=active.get(key);
    // A handle belongs to one registration, not to a reusable worker identity.
    // Fence stale handles synchronously before any asynchronous termination.
    if(expectedRegistrationId && (!entry || entry.registrationId!==expectedRegistrationId))
      throw new Error('Supervised worker registration no longer active');
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
         typeof request.workspaceRoot!=='string'||!isAbsolute(request.workspaceRoot) ||
         request.workspaceRoot.includes('\0') ||
         request.workspaceRoot.split(sep).slice(1).some(segment=>segment==='' || segment==='.' || segment==='..') ||
         normalize(request.workspaceRoot)!==request.workspaceRoot)throw new Error('Invalid trusted worker launch request');
      if(active.has(key)||pending.has(key)||quarantined.has(key))
        throw new Error('Duplicate or quarantined supervised worker attempt');
      let resolvePending!:()=>void;
      const pendingLaunch:PendingLaunch={revoked:false,
        settled:new Promise<void>(resolve=>{resolvePending=resolve}),
        resolve:()=>resolvePending()};
      pending.set(key,pendingLaunch);
      let native:NativeIsolatedWorker|undefined;
      try {
        native=await backend.launch(request);
        if(pendingLaunch.revoked)throw new Error('WorkerSupervisor worker launch revoked before qualification');
        if(!Number.isSafeInteger(native?.pid)||native!.pid<1 ||
           !Number.isSafeInteger(native!.uid)||native!.uid<0 ||
           native!.uid===process.getuid?.() ||
           !/^[1-9][0-9]*$/.test(native!.startTimeTicks) ||
           typeof native!.terminate!=='function'||typeof native!.wait!=='function')
          throw new Error('Untrusted or same-UID worker launch evidence');
        const observed=await readProcess(native!.pid);
        if(!sameProcess(observed,native!))throw new Error('Worker launch process identity mismatch');
        if(pendingLaunch.revoked)throw new Error('WorkerSupervisor worker launch revoked during qualification');
        const registrationId=randomUUID();
        active.set(key,{native:native!,registrationId});
        const evidence=Object.freeze({identity:Object.freeze({...request.identity}),pid:native!.pid,
          uid:native!.uid,startTimeTicks:native!.startTimeTicks,registrationId});
        const launched=native!;
        return Object.freeze({
          evidence,
          cancel:(reason:string)=>revokeEntry(key,reason,registrationId),
          async wait(){
            // A rejected wait is not evidence of process exit. Concurrent
            // callers share one native reap operation. Do not let a stale
            // handle wait on a replacement attempt with the same key.
            const entry=active.get(key);
            if(!entry || entry.registrationId!==registrationId)
              throw new Error('Supervised worker registration no longer active');
            if(entry.waiting)return entry.waiting;
            const operation=Promise.resolve().then(()=>launched.wait());
            entry.waiting=operation;
            try{
              const result=await operation;
              if(active.get(key)===entry && !entry.termination)active.delete(key);
              return result;
            }catch(error){
              if(entry.waiting===operation)entry.waiting=undefined;
              throw error;
            }
          },
        });
      }catch(error){
        if(native){
          // Retain an unqualified worker if cleanup fails. Do not mask the
          // original qualification error or permit a replacement launch.
          if(typeof native.terminate==='function'){
            quarantined.set(key,{native});
            try {await terminateQuarantined(key,'WorkerSupervisor failed launch qualification');}
            catch { /* SECURITY HOLD: unresolved child remains quarantined. */ }
          }else{
            // No callable termination capability exists. The supervisor
            // cannot safely recover or authorize another launch.
            quarantined.set(key,{native});
          }
        }
        throw error;
      }finally{
        pending.delete(key);
        pendingLaunch.resolve();
      }
    },
    async revoke(identity:WorkerGrantIdentity):Promise<void>{
      const key=identityKey(identity);
      const launching=pending.get(key);
      if(launching){
        // Fence before awaiting the asynchronous backend. Launch cannot
        // register after revocation even if its native spawn finishes later.
        launching.revoked=true;
        await launching.settled;
      }
      await revokeEntry(key,'WorkerSupervisor worker revoked');
      await terminateQuarantined(key,'WorkerSupervisor unqualified worker revoked');
      if(quarantined.has(key))throw new Error('WorkerSupervisor unresolved quarantined worker');
    },
    async reconcile():Promise<void>{
      for(const key of quarantined.keys())
        await terminateQuarantined(key,'WorkerSupervisor quarantined worker reconciliation');
      for(const [key,entry] of active){
        const observed=await readProcess(entry.native.pid).catch(()=>undefined);
        if(!sameProcess(observed,entry.native))await revokeEntry(key,'WorkerSupervisor stale worker identity');
      }
    },
  });
}
