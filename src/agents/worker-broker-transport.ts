/** GE-04 Q3.21 continuation: fail-closed, credential-free broker transport.
 * Socket peer authentication is a REQUIRED externally supplied OS attestor.
 * No default or request-body-derived identity is allowed.
 */
import {createServer, type Server, type Socket} from 'node:net';
import type {BrokerPeerPolicy,VerifiedBrokerPeer} from './worker-broker-ipc-boundary.js';
import {assertBrokerPeer} from './worker-broker-ipc-boundary.js';

export type BrokerOsPeerAttestor=(socket:Socket)=>Promise<VerifiedBrokerPeer>;
export type BrokerTransportOptions=Readonly<{
  socketPath:string; peerPolicy:BrokerPeerPolicy;
  /** Must call OS kernel peer credential API on the connected socket. */
  attestPeer:BrokerOsPeerAttestor;
  onAuthorizedPeer:(peer:VerifiedBrokerPeer)=>Promise<void>;
  /** Bounds OS peer attestation; timed-out connections are destroyed. */
  attestationTimeoutMs?:number;
}>;
/** Transport is intentionally limited to one credential-free probe per connection. */
export function createBrokerProbeServer(options:BrokerTransportOptions):Server {
  if (!options.socketPath.startsWith('/') || typeof options.attestPeer!=='function' ||
      typeof options.onAuthorizedPeer!=='function') throw new Error('Broker requires absolute socket path and OS attestor');
  const timeoutMs=options.attestationTimeoutMs ?? 2000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs<1 || timeoutMs>30000) throw new Error('Invalid broker attestation timeout');
  return createServer(socket=>{
    socket.pause();
    const abort=new AbortController();
    const timer=setTimeout(()=>{abort.abort();socket.destroy();},timeoutMs);
    timer.unref();
    socket.once('close',()=>abort.abort());
    void (async()=>{
      try {
        const peer=await Promise.race([options.attestPeer(socket),new Promise<never>((_,reject)=>abort.signal.addEventListener('abort',()=>reject(new Error('Attestation cancelled')),{once:true}))]);
        if (abort.signal.aborted || socket.destroyed) throw new Error('Attestation cancelled');
        assertBrokerPeer(peer,options.peerPolicy);
        if (abort.signal.aborted || socket.destroyed) throw new Error('Attestation cancelled');
        await options.onAuthorizedPeer(peer);
        if (!socket.destroyed) socket.end('OK\n');
      } catch {
        if (!socket.destroyed) socket.destroy();
      } finally {clearTimeout(timer);}
    })();
  });
}
