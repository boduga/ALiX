/** GE-04-CAP: unprivileged, read-only host evidence. Never authorizes launch. */
import {readFile,stat,readlink} from 'node:fs/promises';
import {platform} from 'node:process';
import {classifyLinuxRuntime,type RuntimeEvidence} from './linux-container-runtime-evidence.js';
import {assessLinuxContainment,type CapabilityObservation} from './linux-containment-capabilities.js';
import {inspectCgroupMount} from './linux-containment-discovery.js';

export type ReadOnlySource = {
  read(path:string):Promise<string|undefined>;
  exists(path:string):Promise<boolean>;
  link?(path:string):Promise<string|undefined>;
};
export const linuxReadOnlySource:ReadOnlySource={
  async read(path){try{return await readFile(path,'utf8');}catch{return undefined;}},
  async exists(path){try{await stat(path);return true;}catch{return false;}},
  async link(path){try{return await readlink(path);}catch{return undefined;}}
};
export type LinuxContainmentEvidence = {
  runtime: ReturnType<typeof classifyLinuxRuntime>;
  observation: CapabilityObservation;
  assessment: ReturnType<typeof assessLinuxContainment>;
  notes: string[];
  namespaces: {selfCgroup?:string; initCgroup?:string; selfUser?:string; initUser?:string; comparison: 'same-as-visible-pid1'|'different-from-visible-pid1'|'unknown'};
};
function mappingReadable(text:string|undefined):boolean {
  return !!text && text.trim().split('\n').every(line=>/^\d+\s+\d+\s+\d+$/.test(line.trim()));
}
/** No probes that write cgroupfs, create processes, signal PIDs or require root. */
export async function observeLinuxContainment(source:ReadOnlySource=linuxReadOnlySource,hostPlatform=platform):Promise<LinuxContainmentEvidence>{
  const notes:string[]=[];
  if(hostPlatform!=='linux')notes.push('host-is-not-linux');
  const [systemdContainer,containerEnvValue,dockerEnvMarker,podmanEnvMarker,mountinfo,cgroupControllers,cgroupKill,uidMap,gidMap,selfCgroup,initCgroup,selfUser,initUser]=await Promise.all([
    source.read('/run/systemd/container'),source.read('/run/.containerenv'),source.exists('/.dockerenv'),source.exists('/run/.containerenv'),
    source.read('/proc/self/mountinfo'),source.read('/sys/fs/cgroup/cgroup.controllers'),source.exists('/sys/fs/cgroup/cgroup.kill'),
    source.read('/proc/self/uid_map'),source.read('/proc/self/gid_map'),source.link?.('/proc/self/ns/cgroup'),source.link?.('/proc/1/ns/cgroup'),source.link?.('/proc/self/ns/user'),source.link?.('/proc/1/ns/user')
  ]);
  // /run/.containerenv is an INI-like file, not a runtime name. Presence is a Podman hint only.
  const runtimeEvidence:RuntimeEvidence={systemdContainer, dockerEnvMarker};
  if(podmanEnvMarker)notes.push('containerenv-marker-present-runtime-unverified');
  const runtime=classifyLinuxRuntime(runtimeEvidence);
  if(containerEnvValue!==undefined)notes.push('containerenv-content-not-trusted-as-runtime-identity');
  const cgroup2Mount=inspectCgroupMount(mountinfo).status==='observed';
  if(!cgroup2Mount)notes.push('cgroup2-mount-not-verified');
  if(cgroupControllers===undefined)notes.push('cgroup-controllers-unreadable');
  if(!mappingReadable(uidMap)||!mappingReadable(gidMap))notes.push('namespace-mappings-unreadable');
  if(!selfCgroup||!initCgroup||!selfUser||!initUser)notes.push('namespace-links-unreadable');
  const namespacePattern=/^(cgroup|user):\[\d+\]$/;
  const validNamespaces=!!selfCgroup&&!!initCgroup&&!!selfUser&&!!initUser&&
    [selfCgroup,initCgroup,selfUser,initUser].every(v=>namespacePattern.test(v));
  const comparison= !validNamespaces?'unknown':
    selfCgroup===initCgroup&&selfUser===initUser?'same-as-visible-pid1':'different-from-visible-pid1';
  // PID 1 can itself be namespaced. This comparison cannot establish host namespace identity.
  notes.push('visible-pid1-namespace-comparison-is-not-host-namespace-proof');
  // Existence of a control file is not proof of permission, delegation or pidfd syscall support.
  const observation:CapabilityObservation={platform:hostPlatform,cgroupVersion:cgroup2Mount?2:'unknown',cgroup2Mount,
    cgroupKill:false,pidfd:false,delegatedExclusiveSubtree:false,namespaceMappingKnown:false,
    environment:runtime.container===true?'container':runtime.container===false?'native':'unknown',securityPolicyKnown:false};
  if(cgroupKill)notes.push('cgroup-kill-path-present-but-unverified');
  notes.push('pidfd-delegation-namespace-ownership-and-lsm-require-separate-verification');
  return {runtime,observation,assessment:assessLinuxContainment(observation),notes,
    namespaces:{selfCgroup,initCgroup,selfUser,initUser,comparison}};
}
