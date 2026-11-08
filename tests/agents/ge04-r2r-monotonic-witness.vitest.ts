import {generateKeyPairSync,sign} from 'node:crypto';
import {expect,test} from 'vitest';
import {assessMonotonicWitnessEvidence} from
  '../../src/governance/security/evidence/monotonic-witness.js';
import type {MonotonicTrustAnchor,TrustAnchorSnapshot} from
  '../../src/governance/security/evidence/monotonic-witness.js';

const keys=generateKeyPairSync('ed25519');
const publicKeyHex=keys.publicKey.export({format:'der',type:'spki'})
  .subarray(-32).toString('hex');
const nonce='c'.repeat(64);
const head={revision:2,policySha256:'a'.repeat(64),checkpointSha256:'b'.repeat(64)};
const snapshot:TrustAnchorSnapshot={anchorId:'external-test-anchor',witnessId:'witness-test',
  publicKeyHex,head};
const provider=(s:TrustAnchorSnapshot=snapshot):MonotonicTrustAnchor=>({
  readProtectedSnapshot:async()=>s,
});
const challenge={nonce,bootId:'test-boot',consumedByVerifier:true};
function canonical(value:Record<string,unknown>):string {
  return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b))
    .map(([k,v])=>JSON.stringify(k)+':'+JSON.stringify(v)).join(',')+'}';
}
function receipt(changes:Record<string,unknown>={}, key=keys.privateKey){
  const payload={schema:'ge04-r2p-witness-v1',witnessId:snapshot.witnessId,
    nonce,revision:'2',policySha256:head.policySha256,
    checkpointSha256:head.checkpointSha256,bootId:challenge.bootId,...changes};
  return {payload,signature:sign(null,Buffer.from(canonical(payload),'ascii'),key).toString('hex')};
}
test('matching Ed25519 signature and floor yield consistency, NEVER admission',async()=>{
  const v=await assessMonotonicWitnessEvidence(provider(),receipt(),challenge);
  expect(v).toMatchObject({status:'blocked',evidenceConsistent:true,
    authorizationGranted:false,rollbackResistant:false,witnessAuthorityQualified:false});
  expect(v).not.toHaveProperty('allow');
});
test('provider not configured blocks',async()=>{
  const v=await assessMonotonicWitnessEvidence(undefined as never,receipt(),challenge);
  expect(v.evidenceConsistent).toBe(false);
});
test('provider outage blocks',async()=>{
  const v=await assessMonotonicWitnessEvidence({readProtectedSnapshot:async()=>{throw new Error('offline');}},
    receipt(),challenge);
  expect(v).toMatchObject({status:'blocked',evidenceConsistent:false,authorizationGranted:false});
});
test('snapshot revision rollback or gap blocks',async()=>{
  for(const revision of [1,3]){
    expect((await assessMonotonicWitnessEvidence(provider(),receipt({revision:String(revision)}),challenge))
      .evidenceConsistent).toBe(false);
  }
});
test('policy and checkpoint mismatch block',async()=>{
  for(const change of [{policySha256:'f'.repeat(64)},{checkpointSha256:'e'.repeat(64)}]){
    expect((await assessMonotonicWitnessEvidence(provider(),receipt(change),challenge))
      .evidenceConsistent).toBe(false);
  }
});
test('wrong key or tampered signature blocks',async()=>{
  const other=generateKeyPairSync('ed25519');
  const forged=receipt({},other.privateKey);
  expect((await assessMonotonicWitnessEvidence(provider(),forged,challenge))
    .evidenceConsistent).toBe(false);
  const tampered=receipt();
  tampered.signature='0'.repeat(128);
  expect((await assessMonotonicWitnessEvidence(provider(),tampered,challenge))
    .evidenceConsistent).toBe(false);
});
test('nonce, boot and identity mismatch block',async()=>{
  for(const change of [{nonce:'d'.repeat(64)},{bootId:'old'},{witnessId:'rogue'}]){
    expect((await assessMonotonicWitnessEvidence(provider(),receipt(change),challenge))
      .evidenceConsistent).toBe(false);
  }
});
test('missing or unconsumed challenge blocks',async()=>{
  expect((await assessMonotonicWitnessEvidence(provider(),receipt(),
    {...challenge,consumedByVerifier:false})).evidenceConsistent).toBe(false);
  expect((await assessMonotonicWitnessEvidence(provider(),receipt(),
    {...challenge,nonce:'invalid'})).evidenceConsistent).toBe(false);
});
test('malformed snapshot or receipt fail closed',async()=>{
  const badSnapshot={...snapshot,head:{...head,revision:0}};
  expect((await assessMonotonicWitnessEvidence(provider(badSnapshot),receipt(),challenge))
    .evidenceConsistent).toBe(false);
  expect((await assessMonotonicWitnessEvidence(provider(),{...receipt(),authorization:true},challenge))
    .evidenceConsistent).toBe(false);
  expect((await assessMonotonicWitnessEvidence(provider(),null,challenge))
    .evidenceConsistent).toBe(false);
});
