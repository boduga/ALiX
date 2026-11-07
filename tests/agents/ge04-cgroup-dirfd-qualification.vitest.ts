import {expect,test} from 'vitest';
import {mkdtemp,mkdir,rm,symlink,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';

test.skipIf(process.platform!=='linux')('native cgroup dirfd inspection rejects symlinked leaf and controls',async()=>{
 const dir=await mkdtemp('/tmp/alix-cgroup-dirfd-');
 try{
  const bin=join(dir,'probe');
  const compile=spawnSync('cc',['-Wall','-Wextra','-Werror','-O2','-o',bin,'native/ge04/cgroup-dirfd-qualification.c'],{encoding:'utf8'});
  expect(compile.status,compile.stderr).toBe(0);
  const leaf=join(dir,'leaf');await mkdir(leaf);
  for(const name of ['cgroup.procs','cgroup.events','cgroup.kill'])await writeFile(join(leaf,name),'');
  const run=(name:string)=>spawnSync(bin,[dir,name],{encoding:'utf8',timeout:5000});
  expect(run('leaf').status).toBe(0);
  expect(run('../leaf').status).toBe(64);
  await symlink(leaf,join(dir,'alias'));
  expect(run('alias').status).not.toBe(0);
  await rm(join(leaf,'cgroup.kill'));
  await symlink(join(leaf,'cgroup.procs'),join(leaf,'cgroup.kill'));
  expect(run('leaf').status).not.toBe(0);
 }finally{await rm(dir,{recursive:true,force:true});}
});
