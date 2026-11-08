import {expect,test} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';

test.skipIf(process.platform!=='linux')('fixed-path preflight rejects parameters and unprivileged execution',async()=>{
 const dir=await mkdtemp('/tmp/alix-ge04-fixed-');
 try{
  const bin=join(dir,'probe');
  const build=spawnSync('cc',['-Wall','-Wextra','-Werror','-O2','-o',bin,'native/ge04/cgroup2-fixed-preflight.c'],{encoding:'utf8'});
  expect(build.status,build.stderr).toBe(0);
  expect(spawnSync(bin,['/tmp'],{encoding:'utf8'}).status).toBe(64);
  if(process.geteuid?.()!==0)expect(spawnSync(bin,[],{encoding:'utf8'}).status).toBe(65);
 }finally{await rm(dir,{recursive:true,force:true});}
});
