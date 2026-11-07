/** GE-04-CAP: read-only observations, never authorization to launch workers. */
export type ContainmentEnvironment = 'native'|'container'|'unknown';
export type CapabilityObservation = {
  platform: string;
  cgroupVersion: 1|2|'unknown';
  cgroup2Mount: boolean;
  cgroupKill: boolean;
  pidfd: boolean;
  delegatedExclusiveSubtree: boolean;
  namespaceMappingKnown: boolean;
  environment: ContainmentEnvironment;
  securityPolicyKnown: boolean;
};
export type CapabilityAssessment = {
  eligibleForQualification: boolean;
  authorizedForWorkerLaunch: false;
  reasons: string[];
  environment: ContainmentEnvironment;
};
/** Pure, deterministic gate. A positive result permits qualification planning ONLY. */
export function assessLinuxContainment(o: CapabilityObservation): CapabilityAssessment {
  const reasons: string[] = [];
  if (o.platform !== 'linux') reasons.push('non-linux-platform');
  if (o.cgroupVersion !== 2 || !o.cgroup2Mount) reasons.push('cgroup-v2-unverified');
  if (!o.cgroupKill) reasons.push('cgroup-kill-unverified');
  if (!o.pidfd) reasons.push('pidfd-unverified');
  if (!o.delegatedExclusiveSubtree) reasons.push('exclusive-delegation-unverified');
  if (!o.namespaceMappingKnown) reasons.push('namespace-mapping-unverified');
  if (o.environment === 'unknown') reasons.push('execution-environment-unknown');
  if (!o.securityPolicyKnown) reasons.push('security-policy-unknown');
  return {eligibleForQualification: reasons.length === 0, authorizedForWorkerLaunch: false, reasons, environment:o.environment};
}
