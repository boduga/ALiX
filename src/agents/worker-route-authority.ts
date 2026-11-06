/** GE-04 Q3.9: synthetic immutable route evidence; NOT a durable authority or credential broker. */
import { createHash } from 'node:crypto';
import type { ModelConfig } from '../operations/config/schema.js';
import { buildFallbackChain } from '../models/providers/routing-adapter.js';
import { planWorkerCredentialGrant } from './credential-grant-planner.js';
import type { WorkerGrantIdentity } from './worker-grant-binding.js';
import { assertClaimedWorkerRecord, type ClaimedWorkerRecord } from './worker-grant-record-check.js';

export type RouteCandidate = Readonly<{provider:string;name:string}>;
export type WorkerRouteEvidence = Readonly<{
  identity:WorkerGrantIdentity;
  ownerId:string;
  planRevision:number;
  candidates:readonly RouteCandidate[];
  fingerprint:string;
}>;

function candidatesFor(model:ModelConfig): readonly RouteCandidate[] {
  planWorkerCredentialGrant(model);
  const routes=[model,...buildFallbackChain(model)];
  return Object.freeze(routes.map(route=>{
    if (route.selection !== undefined || typeof route.name !== 'string' || !route.name.trim() ||
        typeof route.provider !== 'string' || !/^[a-z][a-z0-9-]*$/.test(route.provider)) {
      throw new Error('Unresolved or invalid route candidate');
    }
    return Object.freeze({provider:route.provider,name:route.name});
  }));
}
function digest(identity:WorkerGrantIdentity,ownerId:string,planRevision:number,candidates:readonly RouteCandidate[]):string {
  return createHash('sha256').update(JSON.stringify([identity.coordinationRunId,identity.workerId,identity.attempt,ownerId,planRevision,candidates.map(c=>[c.provider,c.name])])).digest('hex');
}
/** Caller must provide a trusted post-claim record and independently authorized resolved model. */
export function captureSyntheticRouteEvidence(record:ClaimedWorkerRecord,identity:WorkerGrantIdentity,ownerId:string,planRevision:number,authorizedModel:ModelConfig):WorkerRouteEvidence {
  assertClaimedWorkerRecord(record,identity,ownerId,planRevision);
  const candidates=candidatesFor(authorizedModel);
  const stableIdentity=Object.freeze({...identity});
  return Object.freeze({identity:stableIdentity,ownerId,planRevision,candidates,fingerprint:digest(stableIdentity,ownerId,planRevision,candidates)});
}
/** Detect route changes; a digest is not a signature or proof of provenance. */
export function assertSyntheticRouteEvidence(evidence:WorkerRouteEvidence,record:ClaimedWorkerRecord,identity:WorkerGrantIdentity,ownerId:string,planRevision:number,proposedModel:ModelConfig):void {
  assertClaimedWorkerRecord(record,identity,ownerId,planRevision);
  const expected=captureSyntheticRouteEvidence(record,identity,ownerId,planRevision,proposedModel);
  if (!evidence || evidence.fingerprint !== expected.fingerprint ||
      evidence.ownerId !== expected.ownerId || evidence.planRevision !== expected.planRevision ||
      JSON.stringify(evidence.identity)!==JSON.stringify(expected.identity) ||
      JSON.stringify(evidence.candidates)!==JSON.stringify(expected.candidates)) {
    throw new Error('Worker route evidence mismatch');
  }
}
