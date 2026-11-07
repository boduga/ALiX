/** GE-04-CAP: conservative container runtime evidence. Never grants launch authority. */
export type RuntimeFamily = 'native'|'docker'|'podman'|'lxc-unresolved'|'unknown';
export type RuntimeEvidence = {
  systemdContainer?: string;
  dockerEnvMarker?: boolean;
  podmanEnvMarker?: boolean;
  containerEnvValue?: string;
  nestedContainerEvidence?: boolean;
};
export type RuntimeClassification = {
  family: RuntimeFamily;
  container: boolean|'unknown';
  management: 'incus'|'standalone-lxc'|'unverified';
  eligibleForContainment: false;
  reasons: string[];
};
/**
 * systemd's 'lxc' marker does NOT distinguish standalone LXC from Incus.
 * Multiple conflicting markers must not be resolved by guesswork.
 */
export function classifyLinuxRuntime(e: RuntimeEvidence): RuntimeClassification {
  const names = new Set<string>();
  const systemd = e.systemdContainer?.trim().toLowerCase();
  if (systemd && systemd !== 'none') names.add(systemd);
  if (e.dockerEnvMarker) names.add('docker');
  if (e.podmanEnvMarker) names.add('podman');
  if (e.containerEnvValue?.trim()) names.add(e.containerEnvValue.trim().toLowerCase());
  const families = new Set<RuntimeFamily>();
  for (const name of names) {
    if (name === 'docker') families.add('docker');
    else if (name === 'podman' || name === 'libpod') families.add('podman');
    else if (name === 'lxc' || name === 'incus') families.add('lxc-unresolved');
    else families.add('unknown');
  }
  const family:RuntimeFamily = families.size === 0 ? 'native' : families.size === 1 ? [...families][0]! : 'unknown';
  const reasons:string[] = [];
  if (families.size > 1) reasons.push('conflicting-runtime-markers');
  if (family === 'unknown') reasons.push('unrecognized-or-ambiguous-runtime');
  if (family === 'lxc-unresolved') reasons.push('lxc-management-unverified');
  if (e.nestedContainerEvidence) reasons.push('nested-container-unqualified');
  reasons.push('runtime-markers-do-not-prove-cgroup-delegation');
  return {family,container:family === 'native' ? false : family === 'unknown' ? 'unknown' : true,
    management:'unverified',eligibleForContainment:false,reasons};
}
