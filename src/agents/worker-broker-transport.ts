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
}>;
/** Transport is intentionally limited to one credential-free probe per connection. */
export function createBrokerProbeServer(options:BrokerTransportOptions):Server {
  if (!options.socketPath.startsWith('/') || typeof options.attestPeer!=='function' ||
      typeof options.onAuthorizedPeer!=='function') throw new Error('Broker requires absolute socket path and OS attestor');
  return createServer(socket=>{
    socket.pause();
    void (async()=>{
      try {
        const peer=await options.attestPeer(socket);
        assertBrokerPeer(peer,options.peerPolicy);
        await options.onAuthorizedPeer(peer);
        if (!socket.destroyed) socket.end('OK\n');
      } catch {
        if (!socket.destroyed) socket.destroy();
      }
    })();
  });
}
