import {expect,test,vi} from 'vitest';
import {WorkerCgroupV2,type CgroupFileAccess} from '../../src/agents/worker-supervisor-cgroup-v2.js';
const leaf='/sys/fs/cgroup/alix-test/worker-1';
const fixture=()=>{
 const write=vi.fn();let events='populated 1\nfrozen 0\n';let members='123\n';
 const access:CgroupFileAccess={read:path=>path.endsWith('cgroup.procs')?members:events,write,
  canonical:p=>p,inspect:p=>({isDirectory:!p.includes('cgroup.'),isFile:p.includes('cgroup.'),isSymbolicLink:false,uid:0})};
 return {access,write,setEvents:(v:string)=>{events=v},setMembers:(v:string)=>{members=v}};
};

test.skipIf(process.platform!=='linux')('attaches stopped child and kills entire cgroup',()=>{
 const f=fixture();const cg=WorkerCgroupV2.open(leaf,f.access);
 cg.attachStoppedChild(123);cg.killTree();
 expect(f.write.mock.calls).toEqual([
  [leaf+'/cgroup.procs','123'],[leaf+'/cgroup.kill','1']]);
 expect(()=>cg.assertEmpty()).toThrow(/still populated/);
 f.setEvents('populated 0\nfrozen 0\n');cg.assertEmpty();
});

test.skipIf(process.platform!=='linux')('rejects untrusted paths, controls, and ambiguous state',()=>{
 const f=fixture();
 expect(()=>WorkerCgroupV2.open('/sys/fs/cgroup/../etc',f.access)).toThrow();
 expect(()=>WorkerCgroupV2.open('/sys/fs/cgroup',f.access)).toThrow();
 expect(()=>WorkerCgroupV2.open(leaf,{...f.access,canonical:p=>p===leaf?'/tmp/escape':p})).toThrow();
 expect(()=>WorkerCgroupV2.open(leaf,{...f.access,inspect:p=>({...f.access.inspect(p),uid:1000})})).toThrow();
 const cg=WorkerCgroupV2.open(leaf,f.access);
 expect(()=>cg.attachStoppedChild(1)).toThrow();
 f.setEvents('populated 0\npopulated 1\n');expect(()=>cg.assertEmpty()).toThrow(/unambiguous/);
 f.setEvents('frozen 0\n');expect(()=>cg.assertEmpty()).toThrow(/unambiguous/);
});

test.skipIf(process.platform!=='linux')('refuses admission when kernel membership does not confirm stopped child',()=>{
 const f=fixture();const cg=WorkerCgroupV2.open(leaf,f.access);
 f.setMembers('456\n');
 expect(()=>cg.attachStoppedChild(123)).toThrow(/attachment not confirmed/);
 f.setMembers('123\nnot-a-pid\n');
 expect(()=>cg.attachStoppedChild(123)).toThrow(/malformed kernel/);
 f.setMembers('123\n456\n');
 expect(()=>cg.attachStoppedChild(123)).not.toThrow();
});
