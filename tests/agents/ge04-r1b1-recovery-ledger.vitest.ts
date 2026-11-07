import {test,expect} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WorkerSupervisorRecoveryLedger} from '../../src/agents/worker-supervisor-recovery-ledger.js';

test.skipIf(process.platform!=='linux')('unresolved worker persists across restart and clears only matching registration',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ge04-ledger-'));
 const path=join(dir,'ledger.db');writeFileSync(path,'',{mode:0o600});
 const record={worker:{coordinationRunId:'run',workerId:'w',attempt:1},
  process:{pid:100,uid:20002,startTimeTicks:'123'},registrationId:'generation-a'};
 try{
  let ledger=new WorkerSupervisorRecoveryLedger(path);
  ledger.register(record);
  expect(()=>ledger.register(record)).toThrow();
  ledger.close();ledger=new WorkerSupervisorRecoveryLedger(path);
  expect(ledger.unresolved()).toEqual([record]);
  expect(()=>ledger.clear(record.worker,'generation-b')).toThrow(/mismatch/);
  expect(ledger.unresolved()).toEqual([record]);
  ledger.clear(record.worker,'generation-a');
  expect(ledger.unresolved()).toEqual([]);
  ledger.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
