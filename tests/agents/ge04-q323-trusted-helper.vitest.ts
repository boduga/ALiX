import {describe,it,expect} from 'vitest';
import {chmodSync,mkdtempSync,mkdirSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {assertTrustedPeercredHelper} from '../../src/agents/worker-broker-trusted-helper.js';
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
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
});
