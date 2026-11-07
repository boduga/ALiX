import {describe,expect,it} from 'vitest';
import {observeLinuxContainment,type ReadOnlySource} from '../../src/agents/linux-containment-observer.js';
const mount='36 29 0:32 / /sys/fs/cgroup rw,nosuid - cgroup2 cgroup rw';
function fixture(files:Record<string,string>={},paths:string[]=[]):ReadOnlySource{
 return {read:async p=>files[p],exists:async p=>paths.includes(p)};
}
describe('GE-04 read-only Linux observations',()=>{
 it('reports cgroup v2 mount but never infers delegation or authorization',async()=>{
  const source=fixture({'/proc/self/mountinfo':mount,'/sys/fs/cgroup/cgroup.controllers':'cpu memory pids',
   '/proc/self/uid_map':'0 1000 1\n','/proc/self/gid_map':'0 1000 1\n'},['/sys/fs/cgroup/cgroup.kill']);
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
 it('containerenv file does not prove Podman',async()=>{
  const result=await observeLinuxContainment(fixture({'/run/.containerenv':'engine="podman"'},['/run/.containerenv']),'linux');
  expect(result.runtime.family).toBe('native');
  expect(result.notes).toContain('containerenv-marker-present-runtime-unverified');
  expect(result.assessment.authorizedForWorkerLaunch).toBe(false);
 });
 it('non-Linux remains denied',async()=>{
  const result=await observeLinuxContainment(fixture(),'darwin');
  expect(result.assessment.reasons).toContain('non-linux-platform');
 });
});
