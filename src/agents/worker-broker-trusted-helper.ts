/** GE-04 Q3.23: fail-closed filesystem qualification for a production peercred helper.
 * Preflight checks path metadata; a separate native launcher execs the pinned helper fd.
 * A trusted immutable deployment and review of mount races remain required.
 */
import {closeSync, constants, fstatSync, lstatSync, openSync, realpathSync} from 'node:fs';
import {dirname, isAbsolute, parse} from 'node:path';

export function assertTrustedPeercredHelper(path:string):void {
  if(process.platform!=='linux' || !isAbsolute(path))throw new Error('Trusted peercred helper requires absolute Linux path');
  if(realpathSync(path)!==path)throw new Error('Trusted peercred helper must not traverse symlinks');
  const root=parse(path).root;
  let current=path;
  let leaf=true;
  while(true){
    const stat=lstatSync(current);
    if(stat.isSymbolicLink() || (leaf ? !stat.isFile() : !stat.isDirectory()))throw new Error('Invalid peercred helper path component');
    if(stat.uid!==0 || (stat.mode & 0o022)!==0)throw new Error('Untrusted peercred helper owner or writable path component');
    if(leaf && ((stat.mode & 0o111)===0 || (stat.mode & 0o6000)!==0))throw new Error('Invalid peercred helper executable mode');
    if(current===root)break;
    current=dirname(current);
    leaf=false;
  }
}

/** Opens the validated executable and pins its inode for exec via inherited fd 4.
 * Caller MUST close the returned fd after spawn. Linux /proc must be mounted.
 * Root-controlled immutable directory/mount remains an operational requirement.
 */
export function openPinnedPeercredHelper(path:string):number {
  assertTrustedPeercredHelper(path);
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const opened=fstatSync(fd);
    const current=lstatSync(path);
    if(!opened.isFile() || opened.uid!==0 || (opened.mode & 0o6022)!==0 || (opened.mode & 0o111)===0 ||
       opened.dev!==current.dev || opened.ino!==current.ino)
      throw new Error('Peercred helper identity or permissions changed');
    return fd;
  } catch(err) {closeSync(fd);throw err;}
}
