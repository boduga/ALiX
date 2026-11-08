import {expect,test} from 'vitest';
import {mkdtempSync,mkdirSync,rmSync,readFileSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {claimAdmissionCustody} from '../../src/agents/worker-supervisor-admission-custody.js';

test('claim is exclusive and records owner',()=>{
 const root=mkdtempSync(join(tmpdir(),'ge04-custody-'));
 try {
  const path=join(root,'claim');
  expect(claimAdmissionCustody(path,'owner-1').ownerId).toBe('owner-1');
  expect(JSON.parse(readFileSync(join(path,'owner.json'),'utf8')).ownerId).toBe('owner-1');
  expect(()=>claimAdmissionCustody(path,'owner-2')).toThrow(/custody already claimed/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('claim survives process exit; second process cannot take over',()=>{
 const root=mkdtempSync(join(tmpdir(),'ge04-custody-'));
 try {
  const path=join(root,'claim');
  const child=spawnSync(process.execPath,['-e',`
   const fs=require('fs');
   fs.mkdirSync(process.argv[1],{mode:0o700});
   fs.writeFileSync(require('path').join(process.argv[1],'owner.json'),'child',{flag:'wx',mode:0o600});
  `,path],{timeout:3000});
  expect(child.status).toBe(0);
  expect(()=>claimAdmissionCustody(path,'replacement')).toThrow(/custody already claimed/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('rejects untrusted parent and invalid owner',()=>{
 const root=mkdtempSync(join(tmpdir(),'ge04-custody-'));
 try{
  const open=join(root,'world-writable');mkdirSync(open,{mode:0o777});
  chmodSync(open,0o777);
  expect(()=>claimAdmissionCustody(join(open,'claim'),'x')).toThrow(/untrusted custody parent/);
  expect(()=>claimAdmissionCustody(join(root,'claim'),'../bad')).toThrow(/invalid custody claim/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
