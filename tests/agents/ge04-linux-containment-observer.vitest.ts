import {describe,expect,it} from 'vitest';
import {observeLinuxContainment,type ReadOnlySource} from '../../src/agents/linux-containment-observer.js';
const mount='36 29 0:32 / /sys/fs/cgroup rw,nosuid - cgroup2 cgroup rw';
function fixture(files:Record<string,string>={},paths:string[]=[]):ReadOnlySource{
 return {read:async p=>files[p],exists:async p=>paths.includes(p)};
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
 it('containerenv file does not prove Podman',async()=>{
  const result=await observeLinuxContainment(fixture({'/run/.containerenv':'engine="podman"'},['/run/.containerenv']),'linux');
  expect(result.runtime.family).toBe('unknown');
  expect(result.observation.environment).toBe('unknown');
  expect(result.notes).toContain('containerenv-marker-present-runtime-unverified');
  expect(result.assessment.authorizedForWorkerLaunch).toBe(false);
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
