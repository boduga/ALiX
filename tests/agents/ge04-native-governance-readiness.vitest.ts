import {expect,test} from 'vitest';
import type {AlixConfig} from '../../src/operations/config/schema.js';
import {computePolicyRevision} from '../../src/governance/policy/policy-revision.js';
import {
  assessGe04NativeGovernanceReadiness,assertGe04ProtectedOperation,
  type ProtectedOperation,
} from '../../src/governance/security/evidence/ge04-native-governance-readiness.js';

const config=():AlixConfig=>({
  permissions:{
    default:'ask',tools:{},protectedPaths:[],allowNetworkDomains:[],
    denyCommands:[],sessionMode:'ask',
    shellWhitelist:{enabled:false,commands:[],allowUnmatched:true},
  },
} as unknown as AlixConfig);
const publication=(policy:AlixConfig)=>({
  anchorId:'anchor-a',epoch:'epoch-a',
  expectedAnchorHeadSha256:'0'.repeat(64),expectedAnchorRevision:0,
  proposedAnchorHeadSha256:'b'.repeat(64),
  policyFingerprintSha256:computePolicyRevision(policy),
  publicationAuthorityId:'alix-governance',
  publisherPrincipalId:'publisher-a',requestId:'request-test-a',
});
const operations:ProtectedOperation[]=[
  'checkpoint.commit','worker.execute','worker.recover',
];

for(const operation of operations){
  test(operation+' matches native ALiX revision but never authorizes',()=>{
    const policy=config();
    const result=assessGe04NativeGovernanceReadiness(
      operation,policy,publication(policy));
    expect(result).toMatchObject({
      status:'blocked',policyFingerprintMatches:true,securityHoldActive:true,
      authorizationGranted:false,independentAnchorQualified:false,
      independentSignerQualified:false,releaseApproved:false,
    });
    expect(result.reasons.length).toBeGreaterThan(4);
    expect(Object.isFrozen(result)).toBe(true);
    expect(()=>assertGe04ProtectedOperation(operation,policy,publication(policy)))
      .toThrow(/GE-04 SECURITY HOLD/);
  });
}

test('native policy change invalidates publication fingerprint',()=>{
  const policy=config();
  const claim=publication(policy);
  const changed=config();
  changed.permissions!.default='deny';
  const result=assessGe04NativeGovernanceReadiness('checkpoint.commit',changed,claim);
  expect(result).toMatchObject({status:'blocked',policyFingerprintMatches:false});
  expect(result.reasons).toContain('native ALiX policy fingerprint mismatch');
});

test('missing and synthetically forged claims cannot make operation available',()=>{
  const policy=config();
  for(const input of [null,{},[],{...publication(policy),requestId:undefined},
                       {...publication(policy),unexpected:true},
                       {...publication(policy),expectedAnchorRevision:NaN},
                       {...publication(policy),expectedAnchorRevision:true},
                       {...publication(policy),policyFingerprintSha256:'f'.repeat(64)},
                       {...publication(policy),expectedAnchorRevision:1}]){
    for(const operation of operations){
      const result=assessGe04NativeGovernanceReadiness(operation,policy,input);
      expect(result.status).toBe('blocked');
      expect(result.authorizationGranted).toBe(false);
      expect(result.securityHoldActive).toBe(true);
    }
  }
});

test('caller-provided fake authorization flags are rejected as unknown fields',()=>{
  const policy=config();
  const fake={...publication(policy),authorizationGranted:true,
    securityHoldActive:false,independentAnchorQualified:true,releaseApproved:true};
  const result=assessGe04NativeGovernanceReadiness('worker.execute',policy,fake);
  expect(result.policyFingerprintMatches).toBe(false);
  expect(result.authorizationGranted).toBe(false);
});

test('unsupported operation string cannot bypass review',()=>{
  expect(()=>assessGe04NativeGovernanceReadiness(
    'unsafe.command' as ProtectedOperation,config(),null)).toThrow(TypeError);
});

test('recovery and execution report distinct outstanding boundaries',()=>{
  const policy=config();
  expect(assessGe04NativeGovernanceReadiness(
    'worker.execute',policy,publication(policy)).reasons.some(x=>x.includes('native supervisor')))
    .toBe(true);
  expect(assessGe04NativeGovernanceReadiness(
    'worker.recover',policy,publication(policy)).reasons.some(x=>x.includes('nonce custody')))
    .toBe(true);
});
