/** GE-04 Q3.23: fail-closed filesystem qualification for a production peercred helper.
 * This is a preflight check, not a race-free executable open/exec boundary.
 * Production invocation must also pin the verified inode or use an immutable mount.
 */
import {lstatSync, realpathSync} from 'node:fs';
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
