import {describe,expect,it} from 'vitest';
import {observeLinuxContainment,type ReadOnlySource} from '../../src/agents/linux-containment-observer.js';
import {discoverLinuxContainment} from '../../src/agents/linux-containment-discovery.js';
const mount='36 29 0:32 / /sys/fs/cgroup rw,nosuid - cgroup2 cgroup rw';
function fixture(files:Record<string,string>={},paths:string[]=[],symlinks:string[]=[]):ReadOnlySource{
 return {read:async p=>files[p],exists:async p=>paths.includes(p)&&!symlinks.includes(p)};
}
describe('GE-04 read-only Linux observations',()=>{
 it('reports cgroup v2 mount but never infers delegation or authorization',async()=>{
  const source=fixture({'/proc/self/mountinfo':mount,'/proc/self/cgroup':'0::/user.slice/session.scope\n','/sys/fs/cgroup/cgroup.controllers':'cpu memory pids',
   '/proc/self/uid_map':'0 1000 1\n','/proc/self/gid_map':'0 1000 1\n'},['/sys/fs/cgroup/user.slice/session.scope/cgroup.kill']);
  const result=await observeLinuxContainment(source,'linux');
  expect(result.observation.cgroupVersion).toBe(2);
  expect(result.observation.delegatedExclusiveSubtree).toBe(false);
  expect(result.observation.cgroupKill).toBe(false);
  expect(result.assessment.authorizedForWorkerLaunch).toBe(false);
  expect(result.assessment.eligibleForQualification).toBe(false);
  expect(result.notes).toContain('cgroup-kill-path-present-but-unverified');
 });
 it('detects LXC marker without asserting Incus management',async()=>{
  const result=await observeLinuxContainment(fixture({'/run/systemd/container':'lxc\n','/proc/self/mountinfo':mount}),'linux');
  expect(result.runtime.family).toBe('lxc-unresolved');
  expect(result.runtime.management).toBe('unverified');
  expect(result.observation.environment).toBe('container');
 });
 it('rejects misleading mountinfo and missing evidence',async()=>{
  const result=await observeLinuxContainment(fixture({'/proc/self/mountinfo':'1 2 0:1 / /sys/fs/cgroup rw - tmpfs tmpfs rw'}),'linux');
  expect(result.observation.cgroupVersion).toBe('unknown');
  expect(result.assessment.reasons).toContain('cgroup-v2-unverified');
 });
 it('does not accept malformed mountinfo that the discovery parser rejects',async()=>{
  const result=await observeLinuxContainment(fixture({'/proc/self/mountinfo':mount.replace('36 29 0:32','invalid 29 0:32')}),'linux');
  expect(result.observation.cgroupVersion).toBe('unknown');
  expect(result.assessment.authorizedForWorkerLaunch).toBe(false);
 });
 it('uses the strict discovery ID-map predicate for zero-length ranges',async()=>{
  const result=await observeLinuxContainment(fixture({
   '/proc/self/uid_map':'0 1000 0\n','/proc/self/gid_map':'0 1000 1\n'
  }),'linux');
  expect(result.notes).toContain('namespace-mappings-unreadable');
  expect(result.assessment.authorizedForWorkerLaunch).toBe(false);
 });
 it('treats containerenv presence as a Podman hint without trusting its content',async()=>{
  const result=await observeLinuxContainment(fixture({'/run/.containerenv':'engine="podman"'},['/run/.containerenv']),'linux');
  expect(result.runtime.family).toBe('podman');
  expect(result.observation.environment).toBe('container');
  expect(result.notes).toContain('containerenv-marker-present-runtime-unverified');
  expect(result.notes).toContain('containerenv-content-not-trusted-as-runtime-identity');
  expect(result.runtime.eligibleForContainment).toBe(false);
  expect(result.assessment.authorizedForWorkerLaunch).toBe(false);
 });
 it('keeps Podman-only runtime classification consistent with discovery',async()=>{
  const files:Record<string,string>={'/proc/self/mountinfo':mount,'/run/.containerenv':'engine="podman"'};
  const observer=await observeLinuxContainment(fixture(files,['/run/.containerenv']),'linux');
  const discovery=await discoverLinuxContainment({
   read:async p=>files[p],link:async()=>undefined,
   kind:async p=>p==='/run/.containerenv'?'file':undefined
  },'linux');
  expect(observer.runtime.family).toBe('podman');
  expect(observer.runtime.family).toBe(discovery.runtime.family);
  expect(observer.runtime.eligibleForContainment).toBe(false);
 });
 it('does not count symlinked runtime markers or cgroup control files as present',async()=>{
  const killPath='/sys/fs/cgroup/user.slice/session.scope/cgroup.kill';
  const source=fixture({
   '/proc/self/mountinfo':mount,
   '/proc/self/cgroup':'0::/user.slice/session.scope\n',
   '/run/.containerenv':'engine="podman"'
  },['/run/.containerenv',killPath],['/run/.containerenv',killPath]);
  const result=await observeLinuxContainment(source,'linux');
  expect(result.runtime.family).toBe('unknown');
  expect(result.notes).not.toContain('containerenv-marker-present-runtime-unverified');
  expect(result.notes).not.toContain('cgroup-kill-path-present-but-unverified');
  expect(result.observation.cgroupKill).toBe(false);
 });
 it('compares namespace inodes without claiming host identity',async()=>{
  const files={'/proc/self/mountinfo':mount};
  const links:Record<string,string>={
   '/proc/self/ns/cgroup':'cgroup:[4026533000]', '/proc/1/ns/cgroup':'cgroup:[4026533001]',
   '/proc/self/ns/user':'user:[4026531837]', '/proc/1/ns/user':'user:[4026531837]'};
  const source={...fixture(files),link:async(p:string)=>links[p]};
  const result=await observeLinuxContainment(source,'linux');
  expect(result.namespaces.comparison).toBe('different-from-visible-pid1');
  expect(result.observation.namespaceMappingKnown).toBe(false);
  expect(result.notes).toContain('visible-pid1-namespace-comparison-is-not-host-namespace-proof');
 });
 it('malformed namespace links remain unknown',async()=>{
  const source={...fixture(),link:async()=> 'not-a-namespace'};
  expect((await observeLinuxContainment(source,'linux')).namespaces.comparison).toBe('unknown');
 });
 it('non-Linux remains denied',async()=>{
  const result=await observeLinuxContainment(fixture(),'darwin');
  expect(result.assessment.reasons).toContain('non-linux-platform');
 });
});
