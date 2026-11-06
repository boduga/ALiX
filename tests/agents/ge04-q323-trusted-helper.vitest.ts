import {describe,it,expect} from 'vitest';
import {chmodSync,mkdtempSync,mkdirSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {assertTrustedPeercredHelper,openPinnedPeercredHelper} from '../../src/agents/worker-broker-trusted-helper.js';
import {closeSync,renameSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
const linux=process.platform==='linux' && process.getuid?.()===0;
describe.skipIf(!linux)('GE-04 Q3.23 root-owned trusted helper preflight',()=>{
 it('rejects writable helper, writable ancestors, symlinks, non-executable and setuid helpers',()=>{
  const dir=mkdtempSync('/root/ge04-q323-');
  const parent=join(dir,'bin');const helper=join(parent,'peercred');
  try{
   chmodSync(dir,0o755);mkdirSync(parent,{mode:0o755});writeFileSync(helper,'test',{mode:0o755});
   expect(()=>assertTrustedPeercredHelper(helper)).not.toThrow();
   chmodSync(helper,0o775);expect(()=>assertTrustedPeercredHelper(helper)).toThrow();chmodSync(helper,0o755);
   chmodSync(parent,0o777);expect(()=>assertTrustedPeercredHelper(helper)).toThrow();chmodSync(parent,0o755);
   chmodSync(helper,0o644);expect(()=>assertTrustedPeercredHelper(helper)).toThrow();chmodSync(helper,0o755);
   chmodSync(helper,0o4755);expect(()=>assertTrustedPeercredHelper(helper)).toThrow();chmodSync(helper,0o755);
   const alias=join(parent,'alias');symlinkSync(helper,alias);expect(()=>assertTrustedPeercredHelper(alias)).toThrow();
   const source=join(parent,'helper.c');
   writeFileSync(source,'#include <stdio.h>\nint main(void){puts(\"ORIGINAL\");return 0;}\n');
   execFileSync('cc',['-o',helper,source]);
   const launcher=join(parent,'launcher');
   execFileSync('cc',['-O2','-Wall','-Wextra','-Werror','-o',launcher,'native/ge04/exec-pinned.c']);
   const pinned=openPinnedPeercredHelper(helper);
   try {
    const moved=join(parent,'original');renameSync(helper,moved);writeFileSync(source,'#include <stdio.h>\nint main(void){puts(\"REPLACEMENT\");return 0;}\n');execFileSync('cc',['-o',helper,source]);
    const result=spawnSync(launcher,[],{stdio:['ignore','pipe','pipe','ignore',pinned]});
    expect(result.error).toBeUndefined();expect(result.status).toBe(0);expect(result.stdout.toString()).toBe('ORIGINAL\n');
   } finally {closeSync(pinned);}
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
});
