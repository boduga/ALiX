import {describe,it,expect} from 'vitest';
import {runSupervisedNativeProbe} from '../../src/agents/worker-broker-supervised-probe.js';

describe.skipIf(process.platform!=='linux')('GE-04 Q3.30 pinned lifecycle fail-closed gates',()=>{
 it('refuses untrusted pinned launcher without falling back to pathname execution',async()=>{
  await expect(runSupervisedNativeProbe({executable:'/bin/true',trustedLauncherPath:'/tmp/untrusted-launcher',socketPath:'/tmp/unused.sock',brokerUid:10001,allowedUid:10002})).rejects.toThrow();
 });
 it('rejects untrusted executable with an otherwise trusted launcher candidate',async()=>{
  await expect(runSupervisedNativeProbe({executable:'/tmp/untrusted-probe',trustedLauncherPath:'/bin/true',socketPath:'/tmp/unused.sock',brokerUid:10001,allowedUid:10002})).rejects.toThrow();
 });
});
