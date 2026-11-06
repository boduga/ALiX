/** GE-04 Q3.27: strict parsing of native attestation evidence.
 * Parsing is NOT authentication: only a broker-owned, protected child pipe may
 * supply this frame. Never accept it from a worker socket or request body.
 */
import type {VerifiedBrokerPeer} from './worker-broker-ipc-boundary.js';

export type NativePeerHandoff=Readonly<{peer:VerifiedBrokerPeer;authorized:boolean}>;
const FRAME=/^PEER pid=([1-9][0-9]*) uid=(0|[1-9][0-9]*) authorized=([01])\n$/;
export function parseNativePeerHandoff(frame:string):NativePeerHandoff {
  if (typeof frame!=='string' || frame.length>128) throw new Error('Invalid native peer frame');
  const match=FRAME.exec(frame);
  if (!match) throw new Error('Invalid native peer frame');
  const pid=Number(match[1]),uid=Number(match[2]);
  if (!Number.isSafeInteger(pid) || pid<1 || !Number.isSafeInteger(uid) || uid<0 || uid>0xffffffff)
    throw new Error('Invalid native peer identity');
  return Object.freeze({peer:Object.freeze({pid,uid,transport:'unix-peer-credentials' as const}),authorized:match[3]==='1'});
}
