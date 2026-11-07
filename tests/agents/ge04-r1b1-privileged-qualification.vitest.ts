/** GE-04 privileged Linux qualification. Runs ONLY in an explicitly provisioned
 * disposable root-owned CI/VM environment, never as a normal unit test.
 * This validates UID transition and protected-file denial, not broker IPC.
 */
import {expect,test} from 'vitest';
import {spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const enabled=process.platform==='linux' && process.getuid?.()===0 &&
  process.env.ALIX_GE04_PRIVILEGED_QUALIFICATION==='1';

test.skipIf(!enabled)('real root-to-worker UID transition and protected file denial',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ge04-root-qualification-'));
 try {
  const launcher=join(dir,'launcher');
  const compile=spawnSync('cc',['-Wall','-Wextra','-Werror','-O2','-o',launcher,
    resolve('native/ge04/isolated-worker-launcher.c')],{encoding:'utf8'});
  expect(compile.status,compile.stderr).toBe(0);
  // Root-owned executable path must be in a root-owned non-writable tree.
  // /tmp is world-writable and therefore intentionally not a valid worker executable.
  const uid=Number(process.env.ALIX_GE04_TEST_WORKER_UID);
  expect(Number.isSafeInteger(uid) && uid>0 && uid!==process.getuid()).toBe(true);
  const denied=spawnSync(launcher,[String(uid),'/tmp',launcher,'probe'],{encoding:'utf8'});
  expect(denied.status).toBe(125);
  expect(denied.stderr).toMatch(/untrusted executable path component/);
  // A real successful transition requires a trusted root-owned deployed
  // launcher and executable; this test must not treat rejection as success.
  const deployed=process.env.ALIX_GE04_TRUSTED_LAUNCHER;
  if(!deployed)throw new Error('GE-04 privileged qualification requires ALIX_GE04_TRUSTED_LAUNCHER');
  const identity=spawnSync(deployed,[String(uid),'/usr','/usr/bin/id','-u'],{encoding:'utf8'});
  expect(identity.status,identity.stderr).toBe(0);
  expect(identity.stdout.trim()).toBe(String(uid));
  const secret=join(dir,'root-secret');
  await writeFile(secret,'ge04-protected-probe',{mode:0o600});await chmod(secret,0o600);
  // /usr/bin/cat receives a single path argument, and must fail after UID drop.
  const access=spawnSync(deployed,[String(uid),'/usr','/usr/bin/cat',secret],{encoding:'utf8'});
  expect(access.status).not.toBe(0);
  expect(access.stdout).not.toContain('ge04-protected-probe');
 }finally{await rm(dir,{recursive:true,force:true});}
});
