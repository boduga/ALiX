/** GE-04 R1-B1 qualification-only cgroup v2 containment adapter.
 * This component must be run by a privileged, exclusive cgroup owner.
 * It is NOT yet integrated into native launch or production admission.
 */
import {readFileSync,writeFileSync,lstatSync,realpathSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';

export type CgroupFileAccess=Readonly<{
 read:(path:string)=>string;
 write:(path:string,value:string)=>void;
 inspect:(path:string)=>Readonly<{isDirectory:boolean;isFile:boolean;isSymbolicLink:boolean;uid:number}>;
 canonical:(path:string)=>string;
}>;
const hostAccess:CgroupFileAccess={
 read:path=>readFileSync(path,'utf8'),
 write:(path,value)=>writeFileSync(path,value,{encoding:'utf8',flag:'w'}),
 inspect:path=>{const s=lstatSync(path);return {isDirectory:s.isDirectory(),isFile:s.isFile(),isSymbolicLink:s.isSymbolicLink(),uid:s.uid}},
 canonical:path=>realpathSync(path),
};

/** A precreated dedicated leaf cgroup, never the current process's cgroup. */
export class WorkerCgroupV2 {
 private constructor(private readonly leaf:string,private readonly access:CgroupFileAccess){}
 static open(leaf:string,access:CgroupFileAccess=hostAccess):WorkerCgroupV2 {
  if(process.platform!=='linux'||!leaf.startsWith('/sys/fs/cgroup/')||leaf.includes('\0')||
    leaf.split('/').some(p=>p==='.'||p==='..')||resolve(leaf)!==leaf)
   throw new Error('WorkerSupervisor requires a canonical cgroup v2 leaf path');
  const root='/sys/fs/cgroup';
  if(access.canonical(root)!==root||access.canonical(leaf)!==leaf||
    !relative(root,leaf)||relative(root,leaf).startsWith('..'))
   throw new Error('WorkerSupervisor cgroup path escapes trusted hierarchy');
  // Inspect each component, not merely the final path. In production the
  // privileged owner must pin directory descriptors against replacement.
  let cursor=root;
  for(const segment of relative(root,leaf).split('/')){
   cursor=join(cursor,segment);
   const stat=access.inspect(cursor);
   if(!stat.isDirectory||stat.isSymbolicLink||stat.uid!==0)
    throw new Error('WorkerSupervisor untrusted cgroup path component');
  }
  for(const file of ['cgroup.procs','cgroup.kill','cgroup.events']){
   const stat=access.inspect(join(leaf,file));
   if(!stat.isFile||stat.isSymbolicLink||stat.uid!==0)
    throw new Error('WorkerSupervisor missing trusted cgroup v2 control');
  }
  return new WorkerCgroupV2(leaf,access);
 }
 /** Only attach a still-stopped child before it can fork or exec. */
 attachStoppedChild(pid:number):void {
  if(!Number.isSafeInteger(pid)||pid<=1)throw new Error('WorkerSupervisor invalid child PID');
  this.access.write(join(this.leaf,'cgroup.procs'),String(pid));
  // A successful write alone is not sufficient admission evidence. Verify
  // kernel-reported membership while the trusted launcher remains stopped.
  const members=this.access.read(join(this.leaf,'cgroup.procs'));
  const parsed=members.split('\n').filter(Boolean).map(line=>{
   if(!/^[1-9][0-9]*$/.test(line))
    throw new Error('WorkerSupervisor malformed kernel cgroup membership');
   const value=Number(line);
   if(!Number.isSafeInteger(value))throw new Error('WorkerSupervisor invalid kernel cgroup PID');
   return value;
  });
  if(!parsed.includes(pid))
   throw new Error('WorkerSupervisor SECURITY HOLD: child cgroup attachment not confirmed');
 }
 /** cgroup.kill kills descendants even if they change sessions/process groups. */
 killTree():void {this.access.write(join(this.leaf,'cgroup.kill'),'1');}
 /** Fail closed on unreadable/malformed events; populated=0 is only one
  * necessary condition, not proof of full supervisor crash recovery. */
 isEmpty():boolean {
  const events=this.access.read(join(this.leaf,'cgroup.events'));
  const matches=[...events.matchAll(/^populated\s+([01])\s*$/gm)];
  if(matches.length!==1)throw new Error('WorkerSupervisor cgroup.events lacks unambiguous populated state');
  return matches[0]![1]==='0';
 }
 assertEmpty():void {
  if(!this.isEmpty())throw new Error('WorkerSupervisor SECURITY HOLD: worker cgroup still populated');
 }
}
