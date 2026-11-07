import {test,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

// Unprivileged CI must prove the launcher refuses to become an accidental
// same-UID or rootless bypass. Real root->isolated UID tests are a separate gate.
test.skipIf(process.platform!=='linux' || process.getuid?.()===0)('native launcher fails closed without privileged supervisor',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ge04-native-'));
 try{
  const exe=join(dir,'isolated-launcher');
  const compile=spawnSync('cc',['-Wall','-Wextra','-Werror','-O2','-o',exe,resolve('native/ge04/isolated-worker-launcher.c')],{encoding:'utf8'});
  if(compile.error && (compile.error as NodeJS.ErrnoException).code==='ENOENT')return;
  expect(compile.status,compile.stderr).toBe(0);
  const denied=spawnSync(exe,['20002','/tmp','/usr/bin/id','-u'],{encoding:'utf8'});
  expect(denied.status).toBe(125);
  expect(denied.stderr).toMatch(/requires privileged trusted supervisor/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
