import {expect,test} from 'vitest';
import {assessRecoveryEvidence} from '../../src/agents/worker-supervisor-recovery-assessment.js';
const worker={coordinationRunId:'run',workerId:'w',attempt:1};
const record={worker,registrationId:'reg',state:'launching' as const};
const evidence={worker,registrationId:'reg',kernelIdentityChecked:true,cgroupOwnershipChecked:true,cgroupEmptyChecked:true,descendantsReaped:true,filesystemCustodyChecked:true,independentVerifierId:'verifier-1'};
test('missing evidence denies eligibility',()=>{
 const result=assessRecoveryEvidence(record,undefined);
 expect(result.eligibleForManualReview).toBe(false);
 expect(result.reasons).toContain('missing independent recovery evidence');
});
test('all checks required for manual review, never automatic clearance',()=>{
 const result=assessRecoveryEvidence(record,evidence);
 expect(result).toEqual({eligibleForManualReview:true,reasons:[]});
 expect(result).not.toHaveProperty('authorizedForWorkerLaunch');
});
test('registration mismatch is rejected',()=>{
 expect(assessRecoveryEvidence(record,{...evidence,registrationId:'other'}).eligibleForManualReview).toBe(false);
 expect(assessRecoveryEvidence(record,{...evidence,worker:{...worker,attempt:2}}).eligibleForManualReview).toBe(false);
});
test('each missing attestation blocks manual review',()=>{
 for(const field of ['kernelIdentityChecked','cgroupOwnershipChecked','cgroupEmptyChecked','descendantsReaped','filesystemCustodyChecked'] as const){
  expect(assessRecoveryEvidence(record,{...evidence,[field]:false}).eligibleForManualReview).toBe(false);
 }
 expect(assessRecoveryEvidence(record,{...evidence,independentVerifierId:''}).eligibleForManualReview).toBe(false);
});
