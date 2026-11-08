import {expect,test} from 'vitest';
import {probePinnedRecovery} from '../../src/agents/worker-supervisor-pinned-recovery-probe.js';
const worker={coordinationRunId:'run',workerId:'w',attempt:1};
const record={worker,process:{pid:432,uid:20002,startTimeTicks:'123'},registrationId:'reg'};
const leaf='/sys/fs/cgroup/ge04/worker';
const pin={dev:9n,ino:99n,uid:0,mode:16877,isDirectory:true,isSymbolicLink:false};
const expected={dev:9n,ino:99n};
const absent=Object.assign(new Error('absent'),{code:'ENOENT'});
const base={inspect:()=>pin,read:(p:string)=>{if(p.endsWith('/stat'))throw absent;return 'populated 0\n';}};
test('matching stable root-owned pin and empty cgroup never grants clearance',()=>{
 const r=probePinnedRecovery(record,leaf,expected,base);
 expect(r.cgroupPinStable).toBe(true);expect(r.cgroupPopulated).toBe('no');
 expect(r.processState).toBe('absent');expect(r.status).toBe('blocked');
});
test('inode replacement between observations is denied',()=>{
 let count=0;const r=probePinnedRecovery(record,leaf,expected,{...base,inspect:()=>++count===1.?pin:{...pin,ino:100n}});
 expect(r.cgroupPinStable).toBe(false);expect(r.status).toBe('blocked');
});
test('caller pin mismatch, nonroot ownership, symlink are denied',()=>{
 for(const altered of [{...pin,ino:100n},{...pin,uid:1000},{...pin,isSymbolicLink:true}]){
  expect(probePinnedRecovery(record,leaf,expected,{...base,inspect:()=>altered}).cgroupPinStable).toBe(false);
 }
});
test('missing path, invalid cgroup path and populated state fail closed',()=>{
 const gone=probePinnedRecovery(record,leaf,expected,{...base,inspect:()=>{throw absent;}});
 expect(gone.cgroupPinStable).toBe(false);
 const populated=probePinnedRecovery(record,leaf,expected,{...base,read:p=>p.endsWith('/stat')?(()=>{throw absent;})():'populated 1\n'});
 expect(populated.cgroupPopulated).toBe('yes');expect(populated.status).toBe('blocked');
 expect(()=>probePinnedRecovery(record,'/tmp/worker',expected,base)).toThrow(/invalid pinned/);
});
