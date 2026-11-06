import {describe,it,expect} from 'vitest';
import {parseNativePeerHandoff} from '../../src/agents/worker-broker-native-handoff.js';

describe('GE-04 Q3.27 native handoff frame validation',()=>{
 it('accepts a bounded canonical kernel-peer frame',()=>{
  expect(parseNativePeerHandoff('PEER pid=123 uid=10002 authorized=1\n')).toEqual({peer:{pid:123,uid:10002,transport:'unix-peer-credentials'},authorized:true});
  expect(parseNativePeerHandoff('PEER pid=1 uid=0 authorized=0\n').authorized).toBe(false);
 });
 it('rejects forged or malformed protocol frames',()=>{
  for(const input of ['','READY\n','PEER pid=0 uid=10002 authorized=1\n','PEER pid=1 uid=-1 authorized=1\n',
   'PEER pid=1 uid=10002 authorized=true\n','PEER pid=1 uid=10002 authorized=1\nOK\n',
   'PEER pid=1 uid=10002 authorized=1','PEER pid=1 uid=4294967296 authorized=1\n',
   'PEER pid=9007199254740993 uid=1 authorized=1\n','PEER pid=01 uid=1 authorized=1\n',
   'PEER pid=1 uid=1 authorized=1\n'.repeat(10)]){
   expect(()=>parseNativePeerHandoff(input)).toThrow();
  }
 });
});
