/** GE-04 Q3.29: fd-pinned native probe execution candidate (credential-free).
 * The launcher pathname still requires immutable trusted deployment.
 */
import {spawn} from 'node:child_process';
import {closeSync,constants,fstatSync,lstatSync,openSync} from 'node:fs';
import {qualifyNativeProbeExecutable} from './worker-broker-native-executable.js';
import {assertTrustedPeercredHelper} from './worker-broker-trusted-helper.js';

export function spawnPinnedNativeProbe(executable:string,launcher:string,args:readonly string[]){
  assertTrustedPeercredHelper(launcher);
  qualifyNativeProbeExecutable(executable);
  const fd=openSync(executable,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const opened=fstatSync(fd),current=lstatSync(executable);
    if(!opened.isFile()||opened.uid!==0||(opened.mode&0o6022)!==0||
       opened.dev!==current.dev||opened.ino!==current.ino)
      throw new Error('Native probe executable changed before pinned spawn');
    // fd 3 is inherited into the launcher, which invokes execveat(AT_EMPTY_PATH).
    // The descriptor is pinned even if the pathname changes after open.
    return spawn(launcher,[executable,...args],{shell:false,stdio:['ignore','pipe','pipe',fd],env:{PATH:'/usr/bin:/bin'}});
  }finally{closeSync(fd);}
}
