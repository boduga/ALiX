/**
 * GE-04 R2R: one provider-neutral witness evidence boundary in existing
 * governance/security. Qualification-only, never an authorization result.
 *
 * The witness service signs observations. A distinct provisioned trust anchor
 * must supply a protected key and monotonic floor. Neither this module nor
 * a provider may approve policy, clear recovery, or grant worker admission.
 *
 * No provider is installed or selected here. Unavailable or malformed
 * evidence fails closed. Do not pass repo JSON as a production floor.
 */
import {createPublicKey, verify as verifySignature} from 'node:crypto';

const HEX64=/^[a-f0-9]{64}$/;
const HEX128=/^[a-f0-9]{128}$/;
const REVISION=/^[1-9][0-9]{0,17}$/;

export type WitnessHead=Readonly<{
  revision:number;
  policySha256:string;
  checkpointSha256:string;
}>;

export type TrustAnchorSnapshot=Readonly<{
  witnessId:string;
  publicKeyHex:string;
  head:WitnessHead;
  /** This must originate from the anchor's protected store, never a receipt. */
  anchorId:string;
}>;

/** Implementations must have an independent failure/administration domain. */
export interface MonotonicTrustAnchor {
  readProtectedSnapshot():Promise<TrustAnchorSnapshot>;
}

export type WitnessChallenge=Readonly<{
  nonce:string;
  bootId:string;
  /** Must be issued and atomically consumed by the existing ALiX custody. */
  consumedByVerifier:boolean;
}>;

export type WitnessAssessment=Readonly<{
  status:'blocked';
  evidenceConsistent:boolean;
  reasons:readonly string[];
  witnessAuthorityQualified:false;
  rollbackResistant:false;
  authorizationGranted:false;
}>;

const blocked=(reasons:readonly string[]):WitnessAssessment=>Object.freeze({
  status:'blocked',evidenceConsistent:false,
  reasons:Object.freeze([...reasons]),
  witnessAuthorityQualified:false,
  rollbackResistant:false,authorizationGranted:false,
});

function canonical(value:unknown):string {
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  const entries=Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a<b?-1:a>b?1:0);
  return '{'+entries.map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
}

function isHex64(value:unknown):value is string {
  return typeof value==='string'&&HEX64.test(value);
}

function validSnapshot(value:unknown):value is TrustAnchorSnapshot {
  if(value===null||typeof value!=='object'||Array.isArray(value))return false;
  const v=value as Record<string,unknown>;
  if(Object.keys(v).sort().join()!=='anchorId,head,publicKeyHex,witnessId')return false;
  if(typeof v.anchorId!=='string'||!v.anchorId.trim()||
     typeof v.witnessId!=='string'||!v.witnessId.trim()||
     !isHex64(v.publicKeyHex))return false;
  const h=v.head;
  if(h===null||typeof h!=='object'||Array.isArray(h))return false;
  const head=h as Record<string,unknown>;
  return Object.keys(head).sort().join()==='checkpointSha256,policySha256,revision' &&
    typeof head.revision==='number' && Number.isSafeInteger(head.revision) &&
    head.revision>0 && isHex64(head.policySha256) && isHex64(head.checkpointSha256);
}

function publicKeyDer(raw:Buffer):Buffer {
  // RFC 8410 Ed25519 SubjectPublicKeyInfo: 302a300506032b6570032100 + raw32.
  return Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),raw]);
}

export async function assessMonotonicWitnessEvidence(
  anchor:MonotonicTrustAnchor,
  receipt:unknown,
  challenge:WitnessChallenge,
):Promise<WitnessAssessment> {
  if(!anchor||typeof anchor.readProtectedSnapshot!=='function')
    return blocked(['missing external trust anchor']);
  if(!challenge||!isHex64(challenge.nonce)||
     typeof challenge.bootId!=='string'||!challenge.bootId||
     challenge.consumedByVerifier!==true)
    return blocked(['missing verifier-consumed single-use challenge']);
  let snapshot:unknown;
  try {
    snapshot=await anchor.readProtectedSnapshot();
  } catch {
    return blocked(['external monotonic authority unavailable']);
  }
  if(!validSnapshot(snapshot))return blocked(['untrusted monotonic floor']);
  if(!receipt||typeof receipt!=='object'||Array.isArray(receipt))
    return blocked(['missing signed witness receipt']);
  const r=receipt as Record<string,unknown>;
  if(Object.keys(r).sort().join()!=='payload,signature'||
     typeof r.signature!=='string'||!HEX128.test(r.signature)||
     !r.payload||typeof r.payload!=='object'||Array.isArray(r.payload))
    return blocked(['malformed signed witness receipt']);
  const p=r.payload as Record<string,unknown>;
  if(Object.keys(p).sort().join()!=='bootId,checkpointSha256,nonce,policySha256,revision,schema,witnessId'||
     p.schema!=='ge04-r2p-witness-v1'||typeof p.revision!=='string'||
     !REVISION.test(p.revision)||!isHex64(p.nonce)||
     !isHex64(p.policySha256)||!isHex64(p.checkpointSha256)||
     typeof p.witnessId!=='string'||typeof p.bootId!=='string')
    return blocked(['invalid witness receipt payload']);
  let valid=false;
  try {
    const pub=createPublicKey({key:publicKeyDer(Buffer.from(snapshot.publicKeyHex,'hex')),
      format:'der',type:'spki'});
    valid=verifySignature(null,Buffer.from(canonical(p),'ascii'),pub,Buffer.from(r.signature,'hex'));
  } catch {
    return blocked(['witness signature verification error']);
  }
  if(!valid)return blocked(['invalid witness signature']);
  if(p.nonce!==challenge.nonce||p.bootId!==challenge.bootId||
     p.witnessId!==snapshot.witnessId)
    return blocked(['witness identity or challenge binding mismatch']);
  if(Number(p.revision)!==snapshot.head.revision||
     p.policySha256!==snapshot.head.policySha256||
     p.checkpointSha256!==snapshot.head.checkpointSha256)
    return blocked(['signed witness head differs from independent floor']);
  // Consistency is NOT authorization, independently proven monotonicity or
  // full key provenance. No route to allow is present in this type.
  return Object.freeze({
    status:'blocked',evidenceConsistent:true,
    reasons:Object.freeze(['receipt consistent with supplied anchor snapshot',
      'independent authority deployment and hold-release not qualified']),
    witnessAuthorityQualified:false,rollbackResistant:false,authorizationGranted:false,
  });
}
