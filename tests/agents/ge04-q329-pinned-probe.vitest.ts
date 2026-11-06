import {describe,it,expect} from 'vitest';
import {spawnPinnedNativeProbe} from '../../src/agents/worker-broker-pinned-probe.js';

describe('GE-04 Q3.29 descriptor-pinned launcher gates',()=>{
 it('rejects untrusted launcher and executable before spawning',()=>{
  expect(()=>spawnPinnedNativeProbe('/tmp/unknown','/tmp/launcher',[])).toThrow();
  expect(()=>spawnPinnedNativeProbe('/tmp/unknown','/bin/true',[])).toThrow();
 });
});
