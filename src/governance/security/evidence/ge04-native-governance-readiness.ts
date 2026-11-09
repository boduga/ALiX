/**
 * GE-04 native-governance readiness boundary. Non-authorizing and unwired.
 *
 * This explicitly refuses checkpoint commit, credential-bearing worker launch,
 * and recovery until external independent trust/provisioning/review exists.
 *
 * Never make a successful read/signature, fixture "rolesBound" flag, or
 * caller-supplied securityHoldActive=false into execution authority.
 */
import type {AlixConfig} from '../../../operations/config/schema.js';
import {computePolicyRevision} from '../../policy/policy-revision.js';

export type ProtectedOperation='checkpoint.commit'|'worker.execute'|'worker.recover';

export type NativePolicyPublicationEvidence=Readonly<{
  /** The canonical ALiX fingerprint, NOT the numeric witness revision. */
  policyFingerprintSha256:string;
  anchorId:string;
  epoch:string;
  /** Numeric floor revisions are maintained solely by external trust. */
  expectedAnchorRevision:number;
  expectedAnchorHeadSha256:string;
  proposedAnchorHeadSha256:string;
  publisherPrincipalId:string;
  publicationAuthorityId:string;
  requestId:string;
}>;

export type Ge04SecurityReadiness=Readonly<{
  status:'blocked';
  operation:ProtectedOperation;
  policyFingerprintMatches:boolean;
  authorizationGranted:false;
  securityHoldActive:true;
  independentAnchorQualified:false;
  independentSignerQualified:false;
  releaseApproved:false;
  reasons:readonly string[];
}>;

const HEX64=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9_.:-]{1,128}$/;

function isPublication(value:unknown):value is NativePolicyPublicationEvidence {
  if(value===null||typeof value!=='object'||Array.isArray(value))return false;
  const v=value as Record<string,unknown>;
  if(Object.keys(v).sort().join(',')!==[
    'anchorId','epoch','expectedAnchorHeadSha256','expectedAnchorRevision',
    'policyFingerprintSha256','proposedAnchorHeadSha256',
    'publicationAuthorityId','publisherPrincipalId','requestId',
  ].join(','))return false;
  return typeof v.policyFingerprintSha256==='string'&&HEX64.test(v.policyFingerprintSha256)&&
    typeof v.anchorId==='string'&&ID.test(v.anchorId)&&
    typeof v.epoch==='string'&&ID.test(v.epoch)&&
    typeof v.expectedAnchorRevision==='number'&&
    Number.isSafeInteger(v.expectedAnchorRevision)&&v.expectedAnchorRevision>=0&&
    typeof v.expectedAnchorHeadSha256==='string'&&HEX64.test(v.expectedAnchorHeadSha256)&&
    typeof v.proposedAnchorHeadSha256==='string'&&HEX64.test(v.proposedAnchorHeadSha256)&&
    typeof v.publisherPrincipalId==='string'&&ID.test(v.publisherPrincipalId)&&
    typeof v.publicationAuthorityId==='string'&&ID.test(v.publicationAuthorityId)&&
    typeof v.requestId==='string'&&ID.test(v.requestId)&&
    (v.expectedAnchorRevision!==0||v.expectedAnchorHeadSha256==='0'.repeat(64));
}

/** A check of policy fingerprint only, never evidence of signed approval. */
export function assessGe04NativeGovernanceReadiness(
  operation:ProtectedOperation,
  config:AlixConfig,
  suppliedPublication:unknown,
):Ge04SecurityReadiness {
  if(!(['checkpoint.commit','worker.execute','worker.recover'] as readonly string[])
    .includes(operation))throw new TypeError('Invalid GE-04 protected operation');
  const reasons:string[]=[];
  let matches=false;
  try {
    if(!isPublication(suppliedPublication)){
      reasons.push('missing or malformed native policy-publication binding');
    }else{
      const canonical=computePolicyRevision(config);
      matches=suppliedPublication.policyFingerprintSha256===canonical;
      if(!matches)reasons.push('native ALiX policy fingerprint mismatch');
    }
  }catch{
    reasons.push('canonical ALiX policy revision unavailable');
  }
  // No caller flags can satisfy these. A future integration requires a
  // reviewed provider, custody tokens, independent operator evidence,
  // and Q13-approved release transition at a separately enforced boundary.
  reasons.push('signed policy publication is not established by a matching digest');
  reasons.push('independently administered monotonic anchor not provisioned or proven');
  reasons.push('signer/CA enrollment, revocation and role separation not independently evidenced');
  reasons.push('cross-host rollback, split-view and crash qualification incomplete');
  reasons.push('independent security review and GE-04/Q13 release approval absent');
  if(operation==='worker.execute'){
    reasons.push('trusted native supervisor, broker, grants and final-effect checks not production-qualified');
  }else if(operation==='worker.recover'){
    reasons.push('durable ownership reconciliation and verifier nonce custody not production-qualified');
  }else{
    reasons.push('durable externally protected idempotent committer not production-qualified');
  }
  return Object.freeze({
    status:'blocked',operation,policyFingerprintMatches:matches,
    authorizationGranted:false,securityHoldActive:true,
    independentAnchorQualified:false,independentSignerQualified:false,
    releaseApproved:false,reasons:Object.freeze(reasons),
  });
}

/**
 * This deliberately cannot authorize protected operations. Use at a
 * qualification/admission review boundary; never a fixture-token bypass.
 */
export function assertGe04ProtectedOperation(
  operation:ProtectedOperation,config:AlixConfig,publication:unknown,
):never {
  const assessment=assessGe04NativeGovernanceReadiness(operation,config,publication);
  throw new Error('GE-04 SECURITY HOLD: '+operation+' blocked; '+assessment.reasons.join('; '));
}
