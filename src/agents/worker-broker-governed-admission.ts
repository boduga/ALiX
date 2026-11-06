/** GE-04 Q3.26: credential-free governed admission composition.
 * This does not authenticate the native-to-Node handoff, transport credentials,
 * or authorize secret delivery. The caller MUST supply a trusted attested peer
 * and broker-owned mapping of that peer to the live worker claim.
 */
import type {WorkerGrantIdentity} from './worker-grant-binding.js';
import type {BrokerAuthorizationTicket} from './worker-broker-authorization.js';
import {assertBrokerPeer,type BrokerPeerPolicy,type VerifiedBrokerPeer,BrokerReplayLedger} from './worker-broker-ipc-boundary.js';

export type BrokerAdmissionAuthorizer=Readonly<{
  authorize:(ticket:BrokerAuthorizationTicket,provider:string)=>Promise<void>;
}>;
export type BrokerPeerClaimResolver=(peer:VerifiedBrokerPeer)=>Promise<WorkerGrantIdentity>;

export function createGovernedBrokerAdmission(options:Readonly<{
  peerPolicy:BrokerPeerPolicy;
  resolveLivePeerClaim:BrokerPeerClaimResolver;
  authorizer:BrokerAdmissionAuthorizer;
  replayLedger:BrokerReplayLedger;
  clock?:()=>number;
}>) {
  if (!options || typeof options.resolveLivePeerClaim!=='function' ||
      typeof options.authorizer?.authorize!=='function' || !options.replayLedger ||
      typeof options.replayLedger.consumeAuthenticated!=='function')
    throw new Error('Incomplete broker admission dependencies');
  const clock=options.clock ?? Date.now;
  return Object.freeze({
    async admit(peer:VerifiedBrokerPeer,ticket:BrokerAuthorizationTicket,provider:string):Promise<void>{
      assertBrokerPeer(peer,options.peerPolicy);
      if (!ticket || !ticket.identity || typeof provider!=='string' || !provider)
        throw new Error('Invalid broker admission request');
      // This resolver must use broker-owned live process/worker state, never client claims.
      const claim=await options.resolveLivePeerClaim(peer);
      if (!claim || claim.coordinationRunId!==ticket.identity.coordinationRunId ||
          claim.workerId!==ticket.identity.workerId || claim.attempt!==ticket.identity.attempt)
        throw new Error('Attested peer does not own requested worker claim');
      // Authorizer verifies MAC, live claim, route, revocation, and provider.
      await options.authorizer.authorize(ticket,provider);
      // Persist replay rejection across broker restarts; no await between authorization
      // and consumption. An interrupted admission fails closed, not retryable.
      options.replayLedger.consumeAuthenticated(ticket,clock());
    },
  });
}
