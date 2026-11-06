/** GE-04 Q3.31: Linux procfs process identity reader, credential-free.
 * Not a socket attestor: a trusted broker must obtain the PID from SO_PEERCRED.
 */
import {readFile} from 'node:fs/promises';
import type {BrokerProcessIdentity} from './worker-broker-live-peer-binding.js';

/** /proc/PID/stat field 22 is starttime. comm (field 2) may contain spaces,
 * parentheses and newlines, so split only after the final `) <state> `.
 */
export function parseLinuxProcessStat(stat:string,pid:number):string {
  if(typeof stat!=='string'||stat.length>65536||!Number.isSafeInteger(pid)||pid<1)
    throw new Error('Invalid Linux process stat');
  const prefix=`${pid} (`;
  if(!stat.startsWith(prefix))throw new Error('Linux process PID mismatch');
  const close=stat.lastIndexOf(') ');
  if(close<prefix.length || close+3>=stat.length)throw new Error('Malformed Linux process stat');
  const tail=stat.slice(close+2).trim().split(/\s+/);
  // tail[0] is field 3 (state); tail[19] is field 22 (starttime).
  if(tail.length<20 || !/^[A-Z]$/.test(tail[0]??'') ||
     !/^(0|[1-9][0-9]*)$/.test(tail[19]??''))
    throw new Error('Malformed Linux process starttime');
  return tail[19]!;
}

export function parseLinuxProcessStatusUid(status:string):number {
  if(typeof status!=='string'||status.length>65536)throw new Error('Invalid Linux process status');
  const lines=status.match(/^Uid:\s*([0-9]+)\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)\s*$/gm);
  if(!lines||lines.length!==1)throw new Error('Missing or duplicate Linux process UIDs');
  const values=lines[0]!.replace(/^Uid:\s*/,'').trim().split(/\s+/).map(Number);
  if(values.length!==4||values.some(v=>!Number.isSafeInteger(v)||v<0||v>0xffffffff))
    throw new Error('Invalid Linux process UID');
  // Reject privilege transitions: the kernel's peer UID is effective UID,
  // but real/saved/fs UIDs must also match for this qualification boundary.
  if(values.some(v=>v!==values[1]))throw new Error('Linux process UID transition detected');
  return values[1]!;
}

/** Fail closed for disappearance, inaccessible procfs, or changing identity.
 * Two stat reads bracket the status read to detect PID replacement during IO.
 */
export async function readLinuxProcessIdentity(pid:number):Promise<BrokerProcessIdentity|undefined> {
  if(process.platform!=='linux')throw new Error('Linux process identity requires Linux');
  if(!Number.isSafeInteger(pid)||pid<1||pid>2147483647)throw new Error('Invalid Linux PID');
  const path=`/proc/${pid}`;
  try {
    const before=parseLinuxProcessStat(await readFile(`${path}/stat`,'utf8'),pid);
    const uid=parseLinuxProcessStatusUid(await readFile(`${path}/status`,'utf8'));
    const after=parseLinuxProcessStat(await readFile(`${path}/stat`,'utf8'),pid);
    if(before!==after)throw new Error('Linux process identity changed during read');
    return Object.freeze({pid,uid,startTimeTicks:before});
  }catch(error){
    if((error as NodeJS.ErrnoException)?.code==='ENOENT'||(error as NodeJS.ErrnoException)?.code==='ESRCH')return undefined;
    throw error;
  }
}
