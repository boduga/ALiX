/** GE-04 Q3.20: isolated broker-side signed authorization prototype.
 * The signing key, trusted state and route resolvers MUST remain broker-only.
 * No credential material is read, returned, or delivered here.
 */
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import type {ModelConfig} from '../operations/config/schema.js';
import type {WorkerGrantIdentity} from './worker-grant-binding.js';
import type {ClaimedWorkerRecord} from './worker-grant-record-check.js';
import {assertClaimedWorkerRecord} from './worker-grant-record-check.js';
import {captureSyntheticRouteEvidence} from './worker-route-authority.js';
import {planWorkerCredentialGrant} from './credential-grant-planner.js';

export type BrokerAuthorizationTicket=Readonly<{
  version:1; identity:WorkerGrantIdentity; ownerId:string; planRevision:number;
  routeRevision:number; routeFingerprint:string; providers:readonly string[];
  issuedAt:number; expiresAt:number; nonce:string; mac:string;
}>;
export type BrokerAuthority=Readonly<{
  readClaim:(identity:WorkerGrantIdentity)=>Promise<ClaimedWorkerRecord & {routeRevision:number;revoked:boolean}>;
  resolveRoute:(identity:WorkerGrantIdentity)=>Promise<ModelConfig>;
}>;
export type BrokerClock=()=>number;

/** Construct only in a separate trusted broker process, never in a child worker. */
export function createIsolatedBrokerAuthorizer(authority:BrokerAuthority,key:Uint8Array,clock:BrokerClock=Date.now){
  if (!key || key.byteLength<32) throw new Error('Broker signing key too short');
  const signingKey=Buffer.from(key);
  const used=new Set<string>();
  const sign=(value:Omit<BrokerAuthorizationTicket,'mac'>)=>createHmac('sha256',signingKey).update(JSON.stringify(value)).digest('hex');
  const evidence=async(identity:WorkerGrantIdentity,ownerId:string)=>{
    const record=await authority.readClaim(identity);
    assertClaimedWorkerRecord(record,identity,ownerId,record.planRevision);
    if (record.revoked || !Number.isSafeInteger(record.routeRevision) || record.routeRevision<1) throw new Error('Broker route revoked or invalid');
    const route=await authority.resolveRoute(identity);
    const routeEvidence=captureSyntheticRouteEvidence(record,identity,ownerId,record.planRevision,route);
    return {record,routeEvidence,providers:planWorkerCredentialGrant(route).providers};
  };
  return Object.freeze({
    async issue(identity:WorkerGrantIdentity,ownerId:string,ttlMs=30000):Promise<BrokerAuthorizationTicket>{
      if (!Number.isSafeInteger(ttlMs) || ttlMs<1 || ttlMs>60000) throw new Error('Invalid broker TTL');
      const {record,routeEvidence,providers}=await evidence(identity,ownerId);
      const issuedAt=clock();
      const unsigned={version:1 as const,identity:{...identity},ownerId,planRevision:record.planRevision,
        routeRevision:record.routeRevision,routeFingerprint:routeEvidence.fingerprint,
        providers:[...providers],issuedAt,expiresAt:issuedAt+ttlMs,nonce:randomBytes(24).toString('hex')};
      return Object.freeze({...unsigned,mac:sign(unsigned)});
    },
    /** Single-use check within this broker instance. No credential delivery. */
    async authorize(ticket:BrokerAuthorizationTicket,requestedProvider:string):Promise<void>{
      if (!ticket || ticket.version!==1 || typeof ticket.mac!=='string' || !/^[a-f0-9]{64}$/.test(ticket.mac)) throw new Error('Invalid broker ticket');
      const {mac,...unsigned}=ticket;
      if (!timingSafeEqual(Buffer.from(mac,'hex'),Buffer.from(sign(unsigned),'hex'))) throw new Error('Broker ticket authentication failed');
      const now=clock();
      if (!Number.isSafeInteger(now) || now<ticket.issuedAt || now>=ticket.expiresAt || ticket.expiresAt-ticket.issuedAt>60000)
        throw new Error('Broker ticket expired');
      if (used.has(ticket.nonce)) throw new Error('Broker ticket already consumed');
      if (!ticket.providers.includes(requestedProvider)) throw new Error('Provider not authorized');
      const {record,routeEvidence,providers}=await evidence(ticket.identity,ticket.ownerId);
      if (record.planRevision!==ticket.planRevision || record.routeRevision!==ticket.routeRevision ||
          routeEvidence.fingerprint!==ticket.routeFingerprint ||
          JSON.stringify(providers)!==JSON.stringify(ticket.providers)) throw new Error('Broker authorization stale');
      // No awaits after the replay check: one event-loop turn consumes atomically.
      if (used.has(ticket.nonce)) throw new Error('Broker ticket already consumed');
      used.add(ticket.nonce);
    },
  });
}
