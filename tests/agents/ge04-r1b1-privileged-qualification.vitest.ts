/** GE-04 privileged Linux qualification. Runs ONLY in an explicitly provisioned
 * disposable root-owned CI/VM environment, never as a normal unit test.
 * This validates UID transition, group dropping, environment scrubbing, and
 * protected-file denial, not broker IPC or filesystem/network confinement.
 */
import {expect,test} from 'vitest';
import {spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,chmod,rm,stat,copyFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';

/** Stage regular executable inodes without relaxing the launcher's no-symlink
 * policy. Some multicall utilities reject execveat's /proc/self/exe identity;
 * the explicit test-only GNU selection uses installed standalone alternatives.
 * Only trusted root fixture code selects these fixed system commands.
 */
async function copyFixtureExecutable(dir:string,name:'id'|'env'|'cat'):Promise<string>{
 const target=join(dir,name);
 const prefix=process.env.ALIX_GE04_TEST_GNU_COREUTILS==='1'?'gnu':'';
 await copyFile(`/usr/bin/${prefix}${name}`,target);
 await chmod(target,0o755);
 const metadata=await stat(target);
 expect(metadata.isFile() && metadata.uid===0 && (metadata.mode&0o022)===0).toBe(true);
 return target;
}

const enabled=process.platform==='linux' && process.getuid?.()===0 &&
  process.env.ALIX_GE04_PRIVILEGED_QUALIFICATION==='1';

test.skipIf(!enabled)('real root-to-worker UID transition and protected file denial',async()=>{
 // /run must be root-owned and non-writable by untrusted users. /tmp is
 // unsuitable because the executable's entire ancestry must be trusted.
 const runtime=await stat('/run');
 expect(runtime.uid).toBe(0);
 expect(runtime.mode & 0o022).toBe(0);
 const dir=await mkdtemp('/run/ge04-root-qualification-');
 try {
  await chmod(dir,0o700);
  const launcher=join(dir,'launcher');
  const compile=spawnSync('cc',['-Wall','-Wextra','-Werror','-O2','-o',launcher,
    resolve('native/ge04/isolated-worker-launcher.c')],{encoding:'utf8'});
  expect(compile.status,compile.stderr).toBe(0);
  // A trusted /run path is valid; /tmp is intentionally rejected as executable ancestry.
  const uid=Number(process.env.ALIX_GE04_TEST_WORKER_UID);
  expect(Number.isSafeInteger(uid) && uid>0 && uid!==process.getuid?.()).toBe(true);
  const denied=spawnSync(launcher,[String(uid),'/usr','/tmp/untrusted','-u'],{encoding:'utf8'});
  expect(denied.status).toBe(125);
  expect(denied.stderr).toMatch(/workspace or executable not a regular object|untrusted writable path|untrusted executable path component/);
  // This compiled launcher is root-owned in a trusted directory; never install
  // it setuid or expose it as a general-purpose privileged service.
  const deployed=launcher;
  const idCommand=await copyFixtureExecutable(dir,'id');
  const envCommand=await copyFixtureExecutable(dir,'env');
  const catCommand=await copyFixtureExecutable(dir,'cat');
  const identity=spawnSync(deployed,[String(uid),'/usr',idCommand,'-u'],{encoding:'utf8'});
  expect(identity.status,identity.stderr).toBe(0);
  expect(identity.stdout.trim()).toBe(String(uid));
  const groups=spawnSync(deployed,[String(uid),'/usr',idCommand,'-G'],{encoding:'utf8'});
  expect(groups.status,groups.stderr).toBe(0);
  expect(groups.stdout.trim()).toBe(String(uid));
  const inheritedEnv={...process.env,ALIX_GE04_SECRET_CANARY:'must-not-reach-worker',
    OPENAI_API_KEY:'must-not-reach-worker',HOME:'/root',DBUS_SESSION_BUS_ADDRESS:'unix:path=/run/user/0/bus'};
  const environment=spawnSync(deployed,[String(uid),'/usr',envCommand,'-0'],
    {encoding:'utf8',env:inheritedEnv});
  expect(environment.status,environment.stderr).toBe(0);
  expect(environment.stdout.split('\0').filter(Boolean).sort()).toEqual([
    'HOME=/nonexistent','LANG=C','PATH=/usr/bin:/bin',
  ].sort());
  const secret=join(dir,'root-secret');
  await writeFile(secret,'ge04-protected-probe',{mode:0o600});await chmod(secret,0o600);
  // /usr/bin/cat receives a single path argument, and must fail after UID drop.
  const access=spawnSync(deployed,[String(uid),'/usr',catCommand,secret],{encoding:'utf8'});
  expect(access.status).not.toBe(0);
  expect(access.stdout).not.toContain('ge04-protected-probe');
 }finally{await rm(dir,{recursive:true,force:true});}
});
