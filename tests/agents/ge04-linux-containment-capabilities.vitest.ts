import {describe,expect,it} from 'vitest';
import {assessLinuxContainment,type CapabilityObservation} from '../../src/agents/linux-containment-capabilities.js';
const verified:CapabilityObservation={platform:'linux',cgroupVersion:2,cgroup2Mount:true,cgroupKill:true,pidfd:true,delegatedExclusiveSubtree:true,namespaceMappingKnown:true,environment:'native',securityPolicyKnown:true};
describe('GE-04-CAP qualification-only gate',()=>{
 it('never authorizes worker launch, even for fully verified evidence',()=>{
  expect(assessLinuxContainment(verified)).toEqual({eligibleForQualification:true,authorizedForWorkerLaunch:false,reasons:[],environment:'native'});
 });
 it.each([
  ['platform',{platform:'darwin'},'non-linux-platform'],
  ['cgroup v1',{cgroupVersion:1},'cgroup-v2-unverified'],
  ['unknown version',{cgroupVersion:'unknown'},'cgroup-v2-unverified'],
  ['mount',{cgroup2Mount:false},'cgroup-v2-unverified'],
  ['kill',{cgroupKill:false},'cgroup-kill-unverified'],
  ['pidfd',{pidfd:false},'pidfd-unverified'],
  ['delegation',{delegatedExclusiveSubtree:false},'exclusive-delegation-unverified'],
  ['namespace',{namespaceMappingKnown:false},'namespace-mapping-unverified'],
  ['environment',{environment:'unknown'},'execution-environment-unknown'],
  ['policy',{securityPolicyKnown:false},'security-policy-unknown'],
 ] as const)('denies ambiguous %s',(_name,change,reason)=>{
  const result=assessLinuxContainment({...verified,...change} as CapabilityObservation);
  expect(result.eligibleForQualification).toBe(false);
  expect(result.authorizedForWorkerLaunch).toBe(false);
  expect(result.reasons).toContain(reason);
 });
 it('container evidence is not sufficient without explicit delegation',()=>{
  expect(assessLinuxContainment({...verified,environment:'container',delegatedExclusiveSubtree:false}).eligibleForQualification).toBe(false);
 });
 it('reports all missing evidence instead of first failure',()=>{
  const result=assessLinuxContainment({...verified,cgroupKill:false,pidfd:false,securityPolicyKnown:false});
  expect(result.reasons).toHaveLength(3);
 });
});
