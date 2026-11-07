import {describe,expect,it} from 'vitest';
import {classifyLinuxRuntime} from '../../src/agents/linux-container-runtime-evidence.js';
describe('GE-04 conservative container classification',()=>{
 it.each([
  [{},'native',false],
  [{systemdContainer:'lxc'},'lxc-unresolved',true],
  [{systemdContainer:'incus'},'lxc-unresolved',true],
  [{dockerEnvMarker:true},'docker',true],
  [{podmanEnvMarker:true},'podman',true],
  [{containerEnvValue:'libpod'},'podman',true],
  [{systemdContainer:'unknown-runtime'},'unknown','unknown'],
  [{systemdContainer:'lxc',dockerEnvMarker:true},'unknown','unknown'],
 ] as const)('classifies %j without authorizing containment',(e,family,container)=>{
  const result=classifyLinuxRuntime(e);
  expect(result.family).toBe(family);
  expect(result.container).toBe(container);
  expect(result.eligibleForContainment).toBe(false);
  expect(result.management).toBe('unverified');
 });
 it('does not mistake Incus marker for independently verified Incus management',()=>{
  expect(classifyLinuxRuntime({systemdContainer:'incus'}).reasons).toContain('lxc-management-unverified');
 });
 it('flags nested containers as unqualified',()=>{
  expect(classifyLinuxRuntime({systemdContainer:'lxc',nestedContainerEvidence:true}).reasons).toContain('nested-container-unqualified');
 });
 it('conflicting markers fail ambiguous',()=>{
  expect(classifyLinuxRuntime({systemdContainer:'lxc',podmanEnvMarker:true}).reasons).toContain('conflicting-runtime-markers');
 });
});
