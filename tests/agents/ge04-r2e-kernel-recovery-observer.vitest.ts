import {expect,test} from 'vitest';
import {observeKernelRecovery} from '../../src/agents/worker-supervisor-kernel-recovery-observer.js';
const record={worker:{coordinationRunId:'run',workerId:'w',attempt:1},
 process:{pid:432,uid:20002,startTimeTicks:'123'},registrationId:'reg'};
const path='/sys/fs/cgroup/ge04/worker/cgroup.events';
const stat=(ticks:string)=>'432 (worker with spaces) S '+Array(18).fill('0').join(' ')+' '+ticks+' 0';
test('matching process and populated cgroup never authorize recovery',()=>{
 const r=observeKernelRecovery(record,path,{read:p=>p.endsWith('/stat')?stat('123'):'populated 1\n'});
 expect(r.processState).toBe('matching');expect(r.cgroupPopulated).toBe('yes');
 expect(r.eligibleForRecovery).toBe(false);
});
test('missing process and empty cgroup are still insufficient for clearance',()=>{
 const r=observeKernelRecovery(record,path,{read:p=>{if(p.endsWith('/stat'))throw Object.assign(new Error('missing'),{code:'ENOENT'});return 'populated 0\n';}});
 expect(r.processState).toBe('absent');expect(r.cgroupPopulated).toBe('no');
 expect(r.eligibleForRecovery).toBe(false);
});
test('generation mismatch and unreadable events fail closed',()=>{
 const r=observeKernelRecovery(record,path,{read:p=>{if(p.endsWith('/stat'))return stat('999');throw new Error('permission denied');}});
 expect(r.processState).toBe('different');expect(r.cgroupPopulated).toBe('unknown');
 expect(r.eligibleForRecovery).toBe(false);
});
test('malformed kernel data remains unknown and invalid paths rejected',()=>{
 const r=observeKernelRecovery(record,path,{read:p=>p.endsWith('/stat')?'bad':'populated 0\npopulated 1\n'});
 expect(r.processState).toBe('unknown');expect(r.cgroupPopulated).toBe('unknown');
 expect(()=>observeKernelRecovery(record,'/tmp/cgroup.events')).toThrow(/invalid kernel observation/);
});
