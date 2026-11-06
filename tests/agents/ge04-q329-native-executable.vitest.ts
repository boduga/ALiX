import {describe,it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,chmodSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {qualifyNativeProbeExecutable} from '../../src/agents/worker-broker-native-executable.js';

describe('GE-04 Q3.29 native executable preflight (negative gates)',()=>{
 it('rejects relative paths, missing executables and untrusted temporary ancestry',()=>{
  expect(()=>qualifyNativeProbeExecutable('relative')).toThrow();
  expect(()=>qualifyNativeProbeExecutable('/no/such/alix/native-probe')).toThrow();
  const dir=mkdtempSync(join(tmpdir(),'ge04-q329-'));
  try{
   const file=join(dir,'probe');writeFileSync(file,'#!/bin/sh\nexit 0\n');chmodSync(file,0o755);
   expect(()=>qualifyNativeProbeExecutable(file)).toThrow(/Untrusted|owner|writable/);
   const link=join(dir,'link');symlinkSync(file,link);
   expect(()=>qualifyNativeProbeExecutable(link)).toThrow();
   chmodSync(file,0o777);expect(()=>qualifyNativeProbeExecutable(file)).toThrow();
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
});
