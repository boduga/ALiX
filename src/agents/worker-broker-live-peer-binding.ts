/** GE-04 Q3.31: broker-owned live process/worker-attempt binding primitive.
 * This is NOT a kernel attestor. The supervisor must populate bindings only
 * from trusted process spawn evidence and attest the peer on the accepted FD.
 */
import type {VerifiedBrokerPeer} from './worker-broker-ipc-boundary.js';
import type {WorkerGrantIdentity} from './worker-grant-binding.js';

export type BrokerProcessIdentity=Readonly<{pid:number;uid:number;startTimeTicks:string}>;
export type BrokerLivePeerBinding=Readonly<{
  process:BrokerProcessIdentity;
  worker:WorkerGrantIdentity;
}>;
export type ReadLiveProcessIdentity=(pid:number)=>Promise<BrokerProcessIdentity|undefined>;

function validProcess(value:BrokerProcessIdentity|undefined):value is BrokerProcessIdentity {
  return !!value && Number.isSafeInteger(value.pid) && value.pid>0 &&
    Number.isSafeInteger(value.uid) && value.uid>=0 && value.uid<=0xffffffff &&
    typeof value.startTimeTicks==='string' && /^(0|[1-9][0-9]*)$/.test(value.startTimeTicks);
}
function validWorker(value:WorkerGrantIdentity|undefined):value is WorkerGrantIdentity {
  return !!value && typeof value.coordinationRunId==='string' && value.coordinationRunId.length>0 &&
    typeof value.workerId==='string' && value.workerId.length>0 &&
    Number.isSafeInteger(value.attempt) && value.attempt>=1;
}

/** Bindings are registered by a broker-owned supervisor, not worker input.
 * A resolver never accepts a caller-supplied worker claim. */
export class BrokerLivePeerBindings {
  readonly #bindings=new Map<number,BrokerLivePeerBinding>();
  constructor(private readonly readLiveProcess:ReadLiveProcessIdentity) {
    if(typeof readLiveProcess!=='function')throw new Error('Live process reader required');
  }
  register(binding:BrokerLivePeerBinding):void {
    if(!validProcess(binding?.process)||!validWorker(binding?.worker))
      throw new Error('Invalid broker-owned process binding');
    if(this.#bindings.has(binding.process.pid))throw new Error('PID already registered');
    this.#bindings.set(binding.process.pid,Object.freeze({
      process:Object.freeze({...binding.process}),worker:Object.freeze({...binding.worker}),
    }));
  }
  revoke(pid:number):void {this.#bindings.delete(pid);}
  async resolve(peer:VerifiedBrokerPeer):Promise<WorkerGrantIdentity> {
    if(!peer||peer.transport!=='unix-peer-credentials'||!Number.isSafeInteger(peer.pid)||peer.pid<1||
       !Number.isSafeInteger(peer.uid)||peer.uid<0)throw new Error('Invalid kernel peer');
    const binding=this.#bindings.get(peer.pid);
    if(!binding||binding.process.uid!==peer.uid)throw new Error('No matching live worker binding');
    const current=await this.readLiveProcess(peer.pid);
    // Verify identity again after the asynchronous process lookup; a revoked or
    // replaced registration must never resolve successfully.
    if(this.#bindings.get(peer.pid)!==binding || !validProcess(current)||
       current.pid!==binding.process.pid||current.uid!==binding.process.uid||
       current.startTimeTicks!==binding.process.startTimeTicks)
      throw new Error('Worker process exited, changed, or binding revoked');
    return binding.worker;
  }
}
