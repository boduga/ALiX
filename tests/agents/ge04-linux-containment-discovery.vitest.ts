import {describe,expect,it} from 'vitest';
import {discoverLinuxContainment,inspectCgroupMount,inspectCgroupMembership,inspectIdMap,resolveCgroupKillPath,type DiscoveryIO} from '../../src/agents/linux-containment-discovery.js';
const mount='36 29 0:32 / /sys/fs/cgroup rw,nosuid - cgroup2 cgroup rw\n';
const base:Record<string,string>={
 '/proc/self/mountinfo':mount,'/proc/self/cgroup':'0::/user.slice/session.scope\n',
 '/proc/self/uid_map':'0 100000 65536\n','/proc/self/gid_map':'0 100000 65536\n',
 '/run/systemd/container':'lxc\n','/sys/fs/selinux/enforce':'1','/sys/module/apparmor/parameters/enabled':'Y\n'};
const ns:Record<string,string>={'/proc/self/ns/user':'user:[4026531837]',
 '/proc/self/ns/pid':'pid:[4026531836]','/proc/self/ns/cgroup':'cgroup:[4026531835]'};
function fixture(files:Record<string,string>=base,kinds:Record<string,'file'|'directory'|'symlink'|'other'>={},links=ns):DiscoveryIO{
 return {read:async p=>files[p],kind:async p=>kinds[p],link:async p=>links[p]};
}
describe('GE-04-CAP read-only discovery',()=>{
 it('reports unified mount, namespace and LSM evidence but never authorizes',async()=>{
  const r=await discoverLinuxContainment(fixture(base,{'/sys/fs/cgroup/user.slice/session.scope/cgroup.kill':'file'}),'linux');
  expect(r.mount.status).toBe('observed');expect(r.cgroupMembership.status).toBe('observed');
  expect(r.cgroupKill.status).toBe('observed');expect(r.namespaces.user.status).toBe('observed');
  expect(r.namespaces.uidMap.status).toBe('observed');expect(r.lsm.selinux.detail).toBe('selinux-enforcing');
  expect(r.lsm.apparmor.detail).toBe('apparmor-enabled');
  expect(r.runtime.family).toBe('lxc-unresolved');
  expect(r.exclusiveDelegation.status).toBe('unknown');expect(r.pidfd.status).toBe('unknown');
  expect(r.supportedForQualification).toBe(false);expect(r.authorizedForWorkerLaunch).toBe(false);
 });
 it.each(['docker','podman','lxc','incus','kube','native'] as const)('never grants admission for %s marker',(runtime)=>{
  const files={...base,'/run/systemd/container':runtime==='native'?'':runtime};
  return discoverLinuxContainment(fixture(files),'linux').then(r=>expect(r.authorizedForWorkerLaunch).toBe(false));
 });
 it('does not classify absent runtime markers as native',async()=>{
  const r=await discoverLinuxContainment(fixture({...base,'/run/systemd/container':''}),'linux');
  expect(r.runtime.family).toBe('unknown');
  expect(r.denialReasons).toContain('absence-of-container-markers-does-not-prove-native-host');
  expect(r.authorizedForWorkerLaunch).toBe(false);
 });
 it('flags missing and ambiguous kernel evidence',async()=>{
  const r=await discoverLinuxContainment(fixture({}),'linux');
  expect(r.mount.status).toBe('unknown');expect(r.cgroupMembership.status).toBe('unknown');
  expect(r.denialReasons).toContain('unified-cgroup2-mount-unverified');
 });
 it('does not follow suspicious control file symlink as proof',async()=>{
  const r=await discoverLinuxContainment(fixture(base,{'/sys/fs/cgroup/user.slice/session.scope/cgroup.kill':'symlink'}),'linux');
  expect(r.cgroupKill.status).toBe('unknown');
 });
 it('reports a non-root cgroup mount root as not host-root evidence',async()=>{
  const r=await discoverLinuxContainment(fixture({...base,'/proc/self/mountinfo':mount.replace('0:32 / /sys','0:32 /nested /sys')}),'linux');
  expect(r.mount.status).toBe('observed');
  expect(r.mount.detail).toContain('mount-root=/nested');
  expect(r.denialReasons).toContain('cgroup-mount-root-not-host-root');
  expect(r.authorizedForWorkerLaunch).toBe(false);
 });
 it('does not confuse mount read-write with delegation',async()=>{
  const r=await discoverLinuxContainment(fixture({...base,'/proc/self/mountinfo':mount.replace('rw,nosuid','ro,nosuid')}),'linux');
  expect(r.exclusiveDelegation.status).toBe('unknown');
 });
 it('non-Linux fails closed',async()=>{
  const r=await discoverLinuxContainment(fixture(),'darwin');
  expect(r.denialReasons).toContain('non-linux-platform');
 });
});
describe('strict parsers',()=>{
 it('rejects malformed mountinfo instead of treating it as absent',()=>{
  expect(inspectCgroupMount('malformed').status).toBe('unknown');
  expect(inspectCgroupMount('').status).toBe('unknown');
 });
 it('records observed mount identity but does not claim it is pinned',()=>{
  const evidence=inspectCgroupMount(mount);
  expect(evidence.status).toBe('observed');
  expect(evidence.detail).toContain('mount-id=36');
  expect(evidence.detail).toContain('mount-identity-not-pinned');
 });
 it('rejects malformed mount identity and truncated fields',()=>{
  expect(inspectCgroupMount(mount.replace('36 29 0:32','oops 29 0:32')).status).toBe('unknown');
  expect(inspectCgroupMount('36 29 0:32 / /sys/fs/cgroup rw - cgroup2').status).toBe('unknown');
 });
 it('rejects hybrid and duplicate mounts',()=>{
  expect(inspectCgroupMount(mount.replace('cgroup2 cgroup','tmpfs tmpfs')).status).toBe('absent');
  expect(inspectCgroupMount(mount+mount).status).toBe('unknown');
 });
 it('accepts mountinfo octal escape but rejects wrong mountpoint',()=>{
  expect(inspectCgroupMount(mount.replace('/sys/fs/cgroup','/sys/fs\\057cgroup')).status).toBe('observed');
  expect(inspectCgroupMount(mount.replace('/sys/fs/cgroup','/tmp')).status).toBe('absent');
 });
 it('resolves only unambiguous non-root membership without traversal',()=>{
  expect(resolveCgroupKillPath(mount,'0::/user.slice/session.scope\n')).toBe('/sys/fs/cgroup/user.slice/session.scope/cgroup.kill');
  expect(resolveCgroupKillPath(mount,'0::/\n')).toBeUndefined();
  expect(resolveCgroupKillPath(mount,'0::/../escape\n')).toBeUndefined();
  expect(resolveCgroupKillPath(mount.replace('0:32 / /sys','0:32 /nested /sys'),'0::/user.slice/session.scope\n')).toBeUndefined();
  expect(resolveCgroupKillPath(undefined,'0::/user.slice/session.scope\n')).toBeUndefined();
 });
 it('requires unique unified membership',()=>{
  expect(inspectCgroupMembership('0::/\n').status).toBe('observed');
  expect(inspectCgroupMembership('2:cpu:/\n').status).toBe('unknown');
  expect(inspectCgroupMembership('0::/\n0::/\n').status).toBe('unknown');
 });
 it('rejects malformed ID mappings',()=>{
  expect(inspectIdMap('0 1000 1\n').status).toBe('observed');
  expect(inspectIdMap('0 1000 0\n').status).toBe('unknown');
  expect(inspectIdMap('garbage').status).toBe('unknown');
 });
});
