/** GE-04 R1-B1: canonical supervisor authority contract.
 *
 * Contract-only until the Linux isolation backend and authenticated broker
 * transport are independently qualified. Never treat a JavaScript child-spawn
 * observer or a synthetic peer identity as an implementation of this boundary.
 */
import type {WorkerGrantIdentity} from './worker-grant-binding.js';

export type SupervisedWorkerRequest=Readonly<{
  identity:WorkerGrantIdentity;
  /** An opaque trusted configuration projection identifier, not config or keys. */
  configurationId:string;
  /** Root selected by trusted coordination; worker input cannot override it. */
  workspaceRoot:string;
}>;

export type SupervisedWorkerEvidence=Readonly<{
  identity:WorkerGrantIdentity;
  pid:number;
  uid:number;
  startTimeTicks:string;
  /** Native, independently attested registration; not a worker claim. */
  registrationId:string;
}>;

export interface SupervisedWorkerHandle {
  readonly evidence:SupervisedWorkerEvidence;
  cancel(reason:string):Promise<void>;
  wait():Promise<Readonly<{exitCode:number|null;signal:string|null}>>;
}

/** Only a trusted, platform-specific supervisor may implement this interface. */
export interface WorkerSupervisor {
  launch(request:SupervisedWorkerRequest):Promise<SupervisedWorkerHandle>;
  /** Revokes the registration and terminates the entire worker process tree. */
  revoke(identity:WorkerGrantIdentity):Promise<void>;
  /** Recover durable worker state; never trust worker-supplied registration. */
  reconcile():Promise<void>;
}

export class WorkerSupervisorUnavailableError extends Error {
  constructor(){super('WorkerSupervisor SECURITY HOLD: canonical isolated worker supervisor unavailable');this.name='WorkerSupervisorUnavailableError';}
}

/** Explicit fail-closed implementation for unsupported or unqualified hosts. */
export function unavailableWorkerSupervisor():WorkerSupervisor {
  const deny=async():Promise<never>=>{throw new WorkerSupervisorUnavailableError();};
  return Object.freeze({launch:deny,revoke:deny,reconcile:deny});
}

/** Reject missing or incomplete authority before any caller can dispatch. */
export function requireWorkerSupervisor(value:WorkerSupervisor|undefined):WorkerSupervisor {
  if(!value || typeof value.launch!=='function' || typeof value.revoke!=='function' ||
     typeof value.reconcile!=='function')throw new WorkerSupervisorUnavailableError();
  return value;
}
