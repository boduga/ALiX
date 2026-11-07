import {expect,test,vi} from 'vitest';
import {stopAttachVerifyResume,type StoppedChildIdentity} from '../../src/agents/worker-supervisor-stop-attach.js';
const identity={pid:1234,startTimeTicks:'9876',state:'T' as const};
const fixture=()=>{
 const events:string[]=[];
 const child={pid:1234,observe:vi.fn(async():Promise<StoppedChildIdentity|null>=>identity),resume:vi.fn(async()=>{events.push('resume')}),terminate:vi.fn(async()=>{events.push('terminate')})};
 const cgroup={attachStoppedChild:vi.fn(()=>{events.push('attach')}),killTree:vi.fn(()=>{events.push('kill')}),assertEmpty:vi.fn()};
 return {events,child,cgroup};
};
test('attaches and verifies stopped generation before resume',async()=>{
 const f=fixture();expect(await stopAttachVerifyResume(f.child,f.cgroup)).toEqual(identity);
 expect(f.events).toEqual(['attach','resume']);
 expect(f.child.observe).toHaveBeenCalledTimes(2);
 expect(f.cgroup.assertEmpty).toHaveBeenCalledTimes(1);
});
test('unstopped child never attaches or resumes',async()=>{
 const f=fixture();f.child.observe.mockResolvedValueOnce({...identity,state:'R'} as unknown as StoppedChildIdentity);
 await expect(stopAttachVerifyResume(f.child,f.cgroup)).rejects.toThrow(/not independently stopped/);
 expect(f.events).toEqual(['kill','terminate']);expect(f.cgroup.attachStoppedChild).not.toHaveBeenCalled();
});
test('changed process generation prevents resume and triggers cleanup',async()=>{
 const f=fixture();f.child.observe.mockResolvedValueOnce(identity).mockResolvedValueOnce({...identity,startTimeTicks:'9999'});
 await expect(stopAttachVerifyResume(f.child,f.cgroup)).rejects.toThrow(/generation changed/);
 expect(f.events).toEqual(['attach','kill','terminate']);
});
test('failed membership verification never resumes and attempts cleanup',async()=>{
 const f=fixture();f.cgroup.attachStoppedChild.mockImplementationOnce(()=>{throw new Error('membership absent')});
 await expect(stopAttachVerifyResume(f.child,f.cgroup)).rejects.toThrow('membership absent');
 expect(f.events).toEqual(['kill','terminate']);
});
test('resume failure attempts cleanup without claiming admission',async()=>{
 const f=fixture();f.child.resume.mockRejectedValueOnce(new Error('resume denied'));
 await expect(stopAttachVerifyResume(f.child,f.cgroup)).rejects.toThrow('resume denied');
 expect(f.events).toEqual(['attach','kill','terminate']);
});

test('populated or unreadable cgroup denies launch before observation and resume',async()=>{
 const f=fixture();f.cgroup.assertEmpty.mockImplementationOnce(()=>{throw new Error('cgroup populated')});
 await expect(stopAttachVerifyResume(f.child,f.cgroup)).rejects.toThrow('cgroup populated');
 expect(f.child.observe).not.toHaveBeenCalled();
 expect(f.cgroup.attachStoppedChild).not.toHaveBeenCalled();
 expect(f.child.resume).not.toHaveBeenCalled();
 expect(f.events).toEqual(['kill','terminate']);
});
