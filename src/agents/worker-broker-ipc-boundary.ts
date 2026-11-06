/** GE-04 Q3.21: broker-only IPC authorization boundary primitives.
 * No listener, credential transport, or worker-facing broker is enabled.
 */
import Database from 'better-sqlite3';
import type {BrokerAuthorizationTicket} from './worker-broker-authorization.js';

/** Peer identity must be attested by the OS transport, never parsed from request JSON. */
export type VerifiedBrokerPeer=Readonly<{uid:number;pid:number;transport:'unix-peer-credentials'}>;
export type BrokerPeerPolicy=Readonly<{brokerUid:number;allowedWorkerUids:readonly number[]}>;
export function assertBrokerPeer(peer:VerifiedBrokerPeer|undefined,policy:BrokerPeerPolicy):void {
  if (!peer || peer.transport!=='unix-peer-credentials' || !Number.isSafeInteger(peer.uid) || peer.uid<0 ||
      !Number.isSafeInteger(peer.pid) || peer.pid<1 || !Number.isSafeInteger(policy.brokerUid) ||
      peer.uid===policy.brokerUid || !policy.allowedWorkerUids.includes(peer.uid))
    throw new Error('Unverified or unauthorized broker IPC peer');
}

/** Durable, transactional nonce consumption across processes and restarts.
 * Construct with a broker-owned database path inaccessible to worker UIDs.
 * Caller must authenticate ticket and revalidate current claim BEFORE consume.
 */
export class BrokerReplayLedger {
  private readonly db:Database.Database;
  constructor(path:string){
    this.db=new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec('CREATE TABLE IF NOT EXISTS broker_nonce (nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)');
  }
  consumeAuthenticated(ticket:BrokerAuthorizationTicket,now:number):void {
    if (!ticket || typeof ticket.nonce!=='string' || !/^[a-f0-9]{48}$/.test(ticket.nonce) ||
        !Number.isSafeInteger(ticket.expiresAt) || !Number.isSafeInteger(now) || now>=ticket.expiresAt)
      throw new Error('Invalid or expired broker nonce');
    const insert=this.db.prepare('INSERT OR IGNORE INTO broker_nonce (nonce,expires_at) VALUES (?,?)');
    const result=this.db.transaction(()=>insert.run(ticket.nonce,ticket.expiresAt))();
    if (result.changes!==1) throw new Error('Broker nonce already consumed');
  }
  close():void{this.db.close();}
}
