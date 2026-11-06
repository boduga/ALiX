import {describe,it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runSupervisedNativeProbe} from '../../src/agents/worker-broker-supervised-probe.js';
const base={socketPath:'/tmp/unused.sock',brokerUid:10001,allowedUid:10002,timeoutMs:1000};
function fixture(script:string){const dir=mkdtempSync(join(tmpdir(),'ge04-q328-'));const executable=join(dir,'probe');writeFileSync(executable,`#!/bin/sh\n${script}\n`);chmodSync(executable,0o700);return {executable,close:()=>rmSync(dir,{recursive:true,force:true})};}
describe('GE-04 Q3.28 supervised probe lifecycle (no credentials)',()=>{
 it('accepts only canonical frame from successful supervised child exit',async()=>{
  const f=fixture("printf 'READY\\nPEER pid=123 uid=10002 authorized=1\\n'");
  try{await expect(runSupervisedNativeProbe({...base,executable:f.executable})).resolves.toEqual({peer:{pid:123,uid:10002,transport:'unix-peer-credentials'},authorized:true});}finally{f.close();}
 });
 it('fails closed for forged extra frames, failed child, missing readiness, and timeout',async()=>{
  for(const script of ["printf 'READY\\nPEER pid=1 uid=10002 authorized=1\\nEXTRA\\n'",'exit 7',"printf 'PEER pid=1 uid=10002 authorized=1\\n'",'sleep 3']){
   const f=fixture(script);try{await expect(runSupervisedNativeProbe({...base,executable:f.executable,timeoutMs:150})).rejects.toThrow();}finally{f.close();}
  }
 });
 it('rejects invalid configuration before spawning',async()=>{
  await expect(runSupervisedNativeProbe({...base,executable:'relative'})).rejects.toThrow(/configuration/);
  await expect(runSupervisedNativeProbe({...base,executable:'/does/not/exist',allowedUid:10001})).rejects.toThrow(/configuration/);
 });
});
