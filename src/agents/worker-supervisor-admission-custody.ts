/** GE-04 R2B qualification-only exclusive admission custody.
 * An atomic directory claim prevents two cooperating processes from owning the
 * same custody path. A crash deliberately leaves the claim in place.
 * No stale-owner takeover or production authorization is provided.
 */
import {mkdirSync,openSync,writeSync,fsyncSync,closeSync,statSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';

export type AdmissionCustody=Readonly<{path:string;ownerId:string}>;

/** Fail closed if custody already exists, including after process death. */
export function claimAdmissionCustody(path:string,ownerId:string):AdmissionCustody {
 if(process.platform!=='linux'||!isAbsolute(path)||path.includes('\0')||
    typeof ownerId!=='string'||! /^[a-zA-Z0-9_-]{1,128}$/.test(ownerId))
   throw new Error('WorkerSupervisor SECURITY HOLD: invalid custody claim');
 // The parent directory MUST already be provisioned and protected by the
 // privileged operator; this prototype does not attest ancestry or mount IDs.
 const parent=statSync(join(path,'..'));
 if(!parent.isDirectory()||(parent.mode&0o022)!==0)
   throw new Error('WorkerSupervisor SECURITY HOLD: untrusted custody parent');
 try {mkdirSync(path,{mode:0o700});}
 catch {throw new Error('WorkerSupervisor SECURITY HOLD: custody already claimed or unavailable');}
 // Failure after mkdir is intentionally sticky; never auto-remove a claim.
 const fd=openSync(join(path,'owner.json'),'wx',0o600);
 try {
   writeSync(fd,JSON.stringify({ownerId,pid:process.pid,createdAt:new Date().toISOString()})+'\n');
   fsyncSync(fd);
 } finally {closeSync(fd);}
 return Object.freeze({path,ownerId});
}
