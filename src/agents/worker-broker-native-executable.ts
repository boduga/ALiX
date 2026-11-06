/** GE-04 Q3.29: fail-closed native probe executable preflight.
 * This is a path and descriptor qualification, not a race-free exec boundary.
 */
import {closeSync,constants,fstatSync,lstatSync,openSync,realpathSync} from 'node:fs';
import {assertTrustedPeercredHelper} from './worker-broker-trusted-helper.js';

export function qualifyNativeProbeExecutable(path:string):Readonly<{device:number;inode:number;size:number}> {
  assertTrustedPeercredHelper(path);
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const pinned=fstatSync(fd);
    const pathStat=lstatSync(path);
    if(!pinned.isFile() || pinned.uid!==0 || (pinned.mode&0o6022)!==0 ||
       (pinned.mode&0o111)===0 || pinned.dev!==pathStat.dev || pinned.ino!==pathStat.ino ||
       realpathSync(path)!==path)
      throw new Error('Native probe executable changed during qualification');
    return Object.freeze({device:pinned.dev,inode:pinned.ino,size:pinned.size});
  }finally{closeSync(fd);}
}
