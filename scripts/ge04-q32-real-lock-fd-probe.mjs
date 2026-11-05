/** Real ALiX ApprovalStoreLock on disposable scratch path; HOLD only. */
import { mkdtempSync, rmSync, readFileSync, openSync, closeSync, fstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const base = {gate:'GE04_Q32_REAL_LOCK_FD',disposition:'HOLD',qualified_independent_issuance:false,real_effects_performed:0};
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const tmp=mkdtempSync(join(tmpdir(),'ge04-real-lock-'));
let lock;
try {
 if (process.platform!=='linux' || process.getuid?.()===0 || process.argv[2]!=='--isolated-test') throw Error('nonroot Linux --isolated-test required');
 const { ApprovalStoreLock }=await import(new URL('../dist/src/governance/approvals/approval-store-lock.js',import.meta.url));
 lock=new ApprovalStoreLock(tmp,{backend:'flock',lockPath:join(tmp,'synthetic.lock')});
 const acquired=await lock.acquire(3000);
 const held=lock.isHeld();
 const second=new ApprovalStoreLock(tmp,{backend:'flock',lockPath:join(tmp,'synthetic.lock')});
 const blocked=!(await second.acquire(150));
 second.release();lock.release();lock=undefined;
 const third=new ApprovalStoreLock(tmp,{backend:'flock',lockPath:join(tmp,'synthetic.lock')});
 const reacquired=await third.acquire(3000);third.release();
 const checks={acquired,held,contender_denied:blocked,reacquired_after_release:reacquired};
 console.log(JSON.stringify({...base,checks,all_expected:Object.values(checks).every(Boolean),limits:'actual_ALiX_lock_module_scratch_file_only_no_strace_or_real_daemon_subagent_credential_pipe_proof'}));
} catch(e) {
 console.log(JSON.stringify({...base,reason:e.message.slice(0,180)}));
} finally {lock?.release();rmSync(tmp,{recursive:true,force:true});}
process.exitCode=78;
