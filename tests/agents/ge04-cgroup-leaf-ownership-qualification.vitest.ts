import {expect,test} from 'vitest';
import {mkdtemp,mkdir,rm,stat,symlink} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';

test.skipIf(process.platform!=='linux')('native leaf creation refuses adoption of an existing directory',async()=>{
 const dir=await mkdtemp('/tmp/alix-leaf-owner-');
 try{
  const bin=join(dir,'probe');
  const compile=spawnSync('cc',['-Wall','-Wextra','-Werror','-O2','-o',bin,'native/ge04/cgroup-leaf-ownership-qualification.c'],{encoding:'utf8'});
  expect(compile.status,compile.stderr).toBe(0);
  const run=(name:string)=>spawnSync(bin,[dir,name],{encoding:'utf8',timeout:5000});
  expect(run('../escape').status).toBe(64);
  expect(run('a'.repeat(256)).status).toBe(64);
  await symlink(dir,join(dir,'alias'));
  expect(spawnSync(bin,[join(dir,'alias'),'symlink-root'],{encoding:'utf8'}).status).toBe(70);
  const strict=spawnSync(bin,[dir,'strict-leaf','--require-cgroup2'],{encoding:'utf8'});
  expect(strict.status).toBe(76);
  await expect(stat(join(dir,'strict-leaf'))).rejects.toMatchObject({code:'ENOENT'});
  expect(spawnSync(bin,[dir,'bad-flag','--unknown'],{encoding:'utf8'}).status).toBe(64);
  await mkdir(join(dir,'occupied'));
  expect(run('occupied').status).toBe(73);
  const created=run('new-leaf');expect(created.status,created.stderr).toBe(0);
  expect(created.stdout).toContain('exclusive leaf created');
  expect((await stat(join(dir,'new-leaf'))).isDirectory()).toBe(true);
  expect(run('new-leaf').status).toBe(73);
 }finally{await rm(dir,{recursive:true,force:true});}
});
