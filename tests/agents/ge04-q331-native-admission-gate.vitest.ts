import {describe,it,expect,vi} from 'vitest';
import {parseNativePeerHandoff} from '../../src/agents/worker-broker-native-handoff.js';
import {admitNativeDiagnosticHandoff} from '../../src/agents/worker-broker-native-admission-gate.js';

describe('GE-04 Q3.31 diagnostic provenance must fail closed',()=>{
 it('rejects forged authorized stdout even when canonical',async()=>{
  const handoff=parseNativePeerHandoff('PEER pid=123 uid=10002 authorized=1\n');
  await expect(admitNativeDiagnosticHandoff(handoff,{} as never,'provider')).rejects.toThrow(/SECURITY HOLD/);
 });
 it('rejects unauthorized native stdout and does not consume a ticket',async()=>{
  const handoff=parseNativePeerHandoff('PEER pid=123 uid=10003 authorized=0\n');
  const ticket={nonce:'do-not-consume'} as never;
  await expect(admitNativeDiagnosticHandoff(handoff,ticket,'provider')).rejects.toThrow(/not authenticated/);
 });
 it('does not expose a caller-provided admission callback or bypass switch',async()=>{
  const bypass=vi.fn();
  const handoff=parseNativePeerHandoff('PEER pid=999 uid=10002 authorized=1\n');
  await expect(admitNativeDiagnosticHandoff(handoff,{bypass} as never,'provider')).rejects.toThrow(/SECURITY HOLD/);
  expect(bypass).not.toHaveBeenCalled();
 });
});
