/** GE-04-CAP: unprivileged, read-only host evidence. Never authorizes launch. */
import {readFile,stat} from 'node:fs/promises';
import {platform} from 'node:process';
import {classifyLinuxRuntime,type RuntimeEvidence} from './linux-container-runtime-evidence.js';
import {assessLinuxContainment,type CapabilityObservation} from './linux-containment-capabilities.js';

export type ReadOnlySource = {
  read(path:string):Promise<string|undefined>;
  exists(path:string):Promise<boolean>;
};
export const linuxReadOnlySource:ReadOnlySource={
  async read(path){try{return await readFile(path,'utf8');}catch{return undefined;}},
  async exists(path){try{await stat(path);return true;}catch{return false;}}
};
export type LinuxContainmentEvidence = {
  runtime: ReturnType<typeof classifyLinuxRuntime>;
  observation: CapabilityObservation;
  assessment: ReturnType<typeof assessLinuxContainment>;
  notes: string[];
};
function parseMountinfo(text:string|undefined):boolean {
  if(!text)return false;
  return text.split('\n').some(line=>{
    const parts=line.split(' - ');
    if(parts.length!==2)return false;
    const left=parts[0]!.split(' ');
    return left[4]==='/sys/fs/cgroup' && parts[1]!.split(' ')[0]==='cgroup2';
  });
}
function mappingReadable(text:string|undefined):boolean {
  return !!text && text.trim().split('\n').every(line=>/^\d+\s+\d+\s+\d+$/.test(line.trim()));
}
/** No probes that write cgroupfs, create processes, signal PIDs or require root. */
export async function observeLinuxContainment(source:ReadOnlySource=linuxReadOnlySource,hostPlatform=platform):Promise<LinuxContainmentEvidence>{
  const notes:string[]=[];
  if(hostPlatform!=='linux')notes.push('host-is-not-linux');
  const [systemdContainer,containerEnvValue,dockerEnvMarker,podmanEnvMarker,mountinfo,cgroupControllers,cgroupKill,uidMap,gidMap,cgroupNs,userNs]=await Promise.all([
    source.read('/run/systemd/container'),source.read('/run/.containerenv'),source.exists('/.dockerenv'),source.exists('/run/.containerenv'),
    source.read('/proc/self/mountinfo'),source.read('/sys/fs/cgroup/cgroup.controllers'),source.exists('/sys/fs/cgroup/cgroup.kill'),
    source.read('/proc/self/uid_map'),source.read('/proc/self/gid_map'),source.exists('/proc/self/ns/cgroup').then(v=>v?'present':undefined),source.exists('/proc/self/ns/user').then(v=>v?'present':undefined)
  ]);
  // /run/.containerenv is an INI-like file, not a runtime name. Presence is a Podman hint only.
  const runtimeEvidence:RuntimeEvidence={systemdContainer, dockerEnvMarker};
  if(podmanEnvMarker)notes.push('containerenv-marker-present-runtime-unverified');
  const runtime=classifyLinuxRuntime(runtimeEvidence);
  if(containerEnvValue!==undefined)notes.push('containerenv-content-not-trusted-as-runtime-identity');
  const cgroup2Mount=parseMountinfo(mountinfo);
  if(!cgroup2Mount)notes.push('cgroup2-mount-not-verified');
  if(cgroupControllers===undefined)notes.push('cgroup-controllers-unreadable');
  if(!mappingReadable(uidMap)||!mappingReadable(gidMap))notes.push('namespace-mappings-unreadable');
  if(cgroupNs===undefined||userNs===undefined)notes.push('namespace-links-unreadable');
  // Existence of a control file is not proof of permission, delegation or pidfd syscall support.
  const observation:CapabilityObservation={platform:hostPlatform,cgroupVersion:cgroup2Mount?2:'unknown',cgroup2Mount,
    cgroupKill:false,pidfd:false,delegatedExclusiveSubtree:false,namespaceMappingKnown:false,
    environment:runtime.container===true?'container':runtime.container===false?'native':'unknown',securityPolicyKnown:false};
  if(cgroupKill)notes.push('cgroup-kill-path-present-but-unverified');
  notes.push('pidfd-delegation-namespace-ownership-and-lsm-require-separate-verification');
  return {runtime,observation,assessment:assessLinuxContainment(observation),notes};
}
