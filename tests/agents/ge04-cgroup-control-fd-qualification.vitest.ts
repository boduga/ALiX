import {expect,test} from 'vitest';
import {mkdtemp,mkdir,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';

test.skipIf(process.platform!=='linux')('simulated control fd attachment pins controls and rejects symlink substitution',async()=>{
 const dir=await mkdtemp('/tmp/alix-control-fd-');
 try{
  const bin=join(dir,'probe');
  const cc=spawnSync('cc',['-Wall','-Wextra','-Werror','-O2','-o',bin,'native/ge04/cgroup-control-fd-qualification.c'],{encoding:'utf8'});
  expect(cc.status,cc.stderr).toBe(0);
  const leaf=join(dir,'leaf');await mkdir(leaf);
  for(const name of ['cgroup.procs','cgroup.events','cgroup.kill'])await writeFile(join(leaf,name),'');
  const run=()=>spawnSync(bin,[dir,'leaf'],{encoding:'utf8',timeout:5000});
  expect(run().status).toBe(0);
  expect(await readFile(join(leaf,'cgroup.procs'),'utf8')).toBe('424242\n');
  expect(await readFile(join(leaf,'cgroup.kill'),'utf8')).toBe('');
  await rm(join(leaf,'cgroup.kill'));
  await symlink(join(leaf,'cgroup.events'),join(leaf,'cgroup.kill'));
  expect(run().status).toBe(73);
 }finally{await rm(dir,{recursive:true,force:true});}
});
