/** GE-04-CAP read-only discovery. Evidence is NOT authorization or a mutation probe. */
import {readFile,readlink,lstat} from 'node:fs/promises';
import {platform} from 'node:process';
import {classifyLinuxRuntime} from './linux-container-runtime-evidence.js';
export type EvidenceStatus='observed'|'absent'|'unknown';
export type EvidenceItem={status:EvidenceStatus;detail:string};
export type DiscoveryIO={read(path:string):Promise<string|undefined>;link(path:string):Promise<string|undefined>;kind(path:string):Promise<'file'|'directory'|'symlink'|'other'|undefined>};
export const discoveryIO:DiscoveryIO={
 async read(p){try{return await readFile(p,'utf8')}catch{return undefined}},
 async link(p){try{return await readlink(p)}catch{return undefined}},
 async kind(p){try{const s=await lstat(p);return s.isSymbolicLink()?'symlink':s.isDirectory()?'directory':s.isFile()?'file':'other'}catch{return undefined}}
};
export type LinuxCapabilityReport={
 schemaVersion:1; platform:string; runtime:ReturnType<typeof classifyLinuxRuntime>;
 mount:EvidenceItem; cgroupMembership:EvidenceItem; cgroupKill:EvidenceItem;
 pidfd:EvidenceItem; stoppedChildAttach:EvidenceItem; exclusiveDelegation:EvidenceItem;
 namespaces:{user:EvidenceItem;pid:EvidenceItem;cgroup:EvidenceItem;uidMap:EvidenceItem;gidMap:EvidenceItem};
 lsm:{selinux:EvidenceItem;apparmor:EvidenceItem};
 supportedForQualification:false; authorizedForWorkerLaunch:false; denialReasons:string[];
};
const unknown=(detail:string):EvidenceItem=>({status:'unknown',detail});
const observed=(detail:string):EvidenceItem=>({status:'observed',detail});
const absent=(detail:string):EvidenceItem=>({status:'absent',detail});
function decodeMount(s:string){return s.replace(/\\([0-7]{3})/g,(_m,v:string)=>String.fromCharCode(parseInt(v,8)))}
export function inspectCgroupMount(mountinfo:string|undefined):EvidenceItem{
 if(mountinfo===undefined)return unknown('mountinfo-unreadable');
 const matches=mountinfo.split('\n').filter(Boolean).flatMap(line=>{
  const parts=line.split(' - ');if(parts.length!==2)return [];
  const pre=parts[0]!.split(' '),post=parts[1]!.split(' ');
  if(pre.length<6||post.length<3||decodeMount(pre[4]!)!=='/sys/fs/cgroup')return [];
  return [{type:post[0],root:decodeMount(pre[3]!),options:pre[5]}];
 });
 if(matches.length!==1)return matches.length===0?absent('no-unambiguous-cgroup-mount'):unknown('multiple-cgroup-mounts');
 const m=matches[0]!;
 if(m.type!=='cgroup2')return absent('not-unified-cgroup2');
 return observed('cgroup2-mount-root='+m.root+';options='+m.options+';delegation-not-proven');
}
export function inspectCgroupMembership(data:string|undefined):EvidenceItem{
 if(data===undefined)return unknown('proc-self-cgroup-unreadable');
 const lines=data.trim().split('\n');
 if(lines.length!==1||!/^0::\/(?:[^\n\r]*)$/.test(lines[0]!))return unknown('not-unambiguous-unified-cgroup-membership');
 return observed('unified-membership-reported;namespace-relative-path');
}
export function inspectIdMap(data:string|undefined):EvidenceItem{
 if(data===undefined)return unknown('id-map-unreadable');
 const lines=data.trim().split('\n');
 if(!lines.length||lines.some(line=>!/^\d+\s+\d+\s+[1-9]\d*$/.test(line.trim())))return unknown('id-map-malformed');
 return observed('id-map-readable;host-ownership-unverified');
}
function inspectNamespace(value:string|undefined,type:'user'|'pid'|'cgroup'):EvidenceItem{
 return value&&value.startsWith(type+':[') && /^\w+:\[\d+\]$/.test(value)?observed(type+'-namespace-inode-observed;host-identity-unverified'):unknown(type+'-namespace-unreadable-or-malformed');
}
/** Filesystem observations never prove syscall availability, delegation, or exclusive ownership. */
export async function discoverLinuxContainment(io:DiscoveryIO=discoveryIO,os=platform):Promise<LinuxCapabilityReport>{
 const paths=['/proc/self/mountinfo','/proc/self/cgroup','/proc/self/uid_map','/proc/self/gid_map',
  '/run/systemd/container','/sys/fs/selinux/enforce','/sys/module/apparmor/parameters/enabled'];
 const [mountinfo,membership,uidMap,gidMap,systemd,selinux,apparmor]=await Promise.all(paths.map(p=>io.read(p)));
 const [userNs,pidNs,cgroupNs]=await Promise.all(['user','pid','cgroup'].map(n=>io.link('/proc/self/ns/'+n)));
 const [docker,podman,cgroupKillKind]=await Promise.all(['/.dockerenv','/run/.containerenv','/sys/fs/cgroup/cgroup.kill'].map(p=>io.kind(p)));
 const runtime=classifyLinuxRuntime({systemdContainer:systemd,dockerEnvMarker:docker==='file',podmanEnvMarker:podman==='file'});
 const mount=inspectCgroupMount(mountinfo);
 const cgroupMembership=inspectCgroupMembership(membership);
 const cgroupKill=cgroupKillKind==='file'?observed('control-file-present;write-authority-unverified'):
  cgroupKillKind===undefined?unknown('control-file-unreadable-or-absent'):unknown('control-file-not-regular');
 const namespaces={user:inspectNamespace(userNs,'user'),pid:inspectNamespace(pidNs,'pid'),cgroup:inspectNamespace(cgroupNs,'cgroup'),
  uidMap:inspectIdMap(uidMap),gidMap:inspectIdMap(gidMap)};
 const lsm={selinux:selinux==='0'||selinux==='1'?observed(selinux==='1'?'selinux-enforcing':'selinux-permissive'):
  selinux===undefined?unknown('selinux-state-unavailable'):unknown('selinux-state-malformed'),
  apparmor:apparmor?.trim()==='Y'||apparmor?.trim()==='N'?observed(apparmor.trim()==='Y'?'apparmor-enabled':'apparmor-disabled'):
  unknown('apparmor-state-unavailable-or-malformed')};
 const denialReasons=['read-only-evidence-cannot-prove-exclusive-delegation','pidfd-syscall-not-tested',
  'stopped-child-attach-not-tested','kernel-authenticated-ipc-not-qualified'];
 if(os!=='linux')denialReasons.push('non-linux-platform');
 if(mount.status!=='observed')denialReasons.push('unified-cgroup2-mount-unverified');
 if(cgroupMembership.status!=='observed')denialReasons.push('unified-cgroup-membership-unverified');
 if(runtime.family==='unknown'||runtime.family==='lxc-unresolved')denialReasons.push('runtime-identity-unverified');
 if(runtime.family==='native')denialReasons.push('absence-of-container-markers-does-not-prove-native-host');
 return {schemaVersion:1,platform:os,runtime,mount,cgroupMembership,cgroupKill,
  pidfd:unknown('requires-trusted-syscall-probe'),stoppedChildAttach:unknown('requires-isolated-mutation-qualification'),
  exclusiveDelegation:unknown('requires-pinned-exclusive-leaf-and-authority-qualification'),
  namespaces,lsm,supportedForQualification:false,authorizedForWorkerLaunch:false,denialReasons};
}
