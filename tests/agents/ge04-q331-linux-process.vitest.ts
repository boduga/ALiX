import {describe,it,test,expect} from 'vitest';
import {parseLinuxProcessStat,parseLinuxStoppedProcessStat,readLinuxStoppedProcessIdentity,parseLinuxProcessStatusUid,readLinuxProcessIdentity} from '../../src/agents/worker-broker-linux-process.js';
import {BrokerLivePeerBindings} from '../../src/agents/worker-broker-live-peer-binding.js';
const stat=(pid:number,comm:string,start:string)=>`${pid} (${comm}) S ${Array(18).fill('1').slice(0,18).join(' ')} ${start} 0 0\n`;
describe('GE-04 Q3.31 Linux procfs identity parser',()=>{
 it('extracts field 22 even when comm contains spaces and parentheses',()=>{
  expect(parseLinuxProcessStat(stat(42,'agent ) tricky ( name','12345678901234567890'),42)).toBe('12345678901234567890');
 });
 it('rejects mismatched PID, malformed starttime and incomplete fields',()=>{
  expect(()=>parseLinuxProcessStat(stat(42,'agent','123'),43)).toThrow();
  expect(()=>parseLinuxProcessStat(stat(42,'agent','01'),42)).toThrow();
  expect(()=>parseLinuxProcessStat('42 (agent) S 1 2',42)).toThrow();
 });
 it('requires four identical canonical UID values',()=>{
  expect(parseLinuxProcessStatusUid('Name:\tagent\nUid:\t10002\t10002\t10002\t10002\n')).toBe(10002);
  expect(()=>parseLinuxProcessStatusUid('Uid:\t10002\t0\t10002\t10002\n')).toThrow(/transition/);
  expect(()=>parseLinuxProcessStatusUid('Uid:\t10002\t10002\t10002\t10002\nUid:\t10002\t10002\t10002\t10002\n')).toThrow();
 });
});
describe.skipIf(process.platform!=='linux')('GE-04 Q3.31 live Linux process qualification',()=>{
 it('reads current PID from procfs and binds to the matching worker attempt',async()=>{
  const current=await readLinuxProcessIdentity(process.pid);
  expect(current?.pid).toBe(process.pid);
  expect(current?.uid).toBe(process.geteuid?.());
  expect(current?.startTimeTicks).toMatch(/^[0-9]+$/);
  const bindings=new BrokerLivePeerBindings(readLinuxProcessIdentity);
  bindings.register({process:current!,worker:{coordinationRunId:'test',workerId:'worker',attempt:1}});
  await expect(bindings.resolve({pid:process.pid,uid:current!.uid,transport:'unix-peer-credentials'})).resolves.toEqual({coordinationRunId:'test',workerId:'worker',attempt:1});
 });
 it('rejects absent PID and invalid PID',async()=>{
  await expect(readLinuxProcessIdentity(2147483647)).resolves.toBeUndefined();
  await expect(readLinuxProcessIdentity(-1)).rejects.toThrow();
 });
});

test('stopped-process observer refuses live caller and invalid PID',async()=>{
 if(process.platform!=='linux')return;
 await expect(readLinuxStoppedProcessIdentity(process.pid)).rejects.toThrow(/not stopped/);
 await expect(readLinuxStoppedProcessIdentity(-1)).rejects.toThrow(/Invalid stopped/);
 await expect(readLinuxStoppedProcessIdentity(2147483647)).resolves.toBeNull();
});
test('stopped-process parser requires actual T state, not merely matching starttime',()=>{
 const stopped=stat(42,'agent','123').replace(') S ',') T ');
 expect(parseLinuxStoppedProcessStat(stopped,42)).toEqual({startTimeTicks:'123',state:'T'});
 expect(()=>parseLinuxStoppedProcessStat(stat(42,'agent','123'),42)).toThrow(/not stopped/);
});
