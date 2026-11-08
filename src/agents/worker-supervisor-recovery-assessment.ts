/** GE-04 R2D: qualification-only recovery evidence assessment.
 * This function NEVER clears ledger entries, releases custody, or authorizes launch.
 * Evidence is supplied by an independent privileged verifier, not by a worker.
 */
import type {LaunchIntent,RecoveryRecord} from './worker-supervisor-recovery-ledger.js';
export type RecoveryEvidence=Readonly<{
 registrationId:string;
 worker:Readonly<{coordinationRunId:string;workerId:string;attempt:number}>;
 kernelIdentityChecked:boolean;
 cgroupOwnershipChecked:boolean;
 cgroupEmptyChecked:boolean;
 descendantsReaped:boolean;
 filesystemCustodyChecked:boolean;
 independentVerifierId:string;
}>;
export type RecoveryAssessment=Readonly<{eligibleForManualReview:boolean;reasons:readonly string[]}>;
export function assessRecoveryEvidence(
 record:LaunchIntent|RecoveryRecord,
 evidence:RecoveryEvidence|undefined,
):RecoveryAssessment {
 const reasons:string[]=[];
 if(!record||!record.worker||typeof record.registrationId!=='string'||!record.registrationId)
  reasons.push('invalid durable registration');
 if(!evidence)reasons.push('missing independent recovery evidence');
 else {
  if(!record||!record.worker||evidence.registrationId!==record.registrationId||
    evidence.worker?.coordinationRunId!==record.worker.coordinationRunId||
    evidence.worker?.workerId!==record.worker.workerId||
    evidence.worker?.attempt!==record.worker.attempt)
   reasons.push('registration identity mismatch');
  if(evidence.kernelIdentityChecked!==true)reasons.push('kernel process identity unverified');
  if(evidence.cgroupOwnershipChecked!==true)reasons.push('exclusive cgroup ownership unverified');
  if(evidence.cgroupEmptyChecked!==true)reasons.push('cgroup emptiness unverified');
  if(evidence.descendantsReaped!==true)reasons.push('descendant termination unverified');
  if(evidence.filesystemCustodyChecked!==true)reasons.push('filesystem custody unverified');
  if(typeof evidence.independentVerifierId!=='string'||!evidence.independentVerifierId.trim())
   reasons.push('independent verifier missing');
 }
 return Object.freeze({eligibleForManualReview:reasons.length===0,reasons:Object.freeze(reasons)});
}
