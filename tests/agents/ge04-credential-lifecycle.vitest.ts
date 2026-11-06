import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import type { Writable } from 'node:stream';

const cliUrl = pathToFileURL(resolve(process.cwd(), 'dist/src/agents/subagent-cli.js')).href;
const readerUrl = pathToFileURL(resolve(process.cwd(), 'dist/src/agents/credential-fd-reader.js')).href;
const canary = 'synthetic-ge04-lifecycle-only';
function childRun(code: string, action: (child: ReturnType<typeof spawn>) => void) {
  return new Promise<{code:number|null; stdout:string; stderr:string}>((done, fail) => {
    const child = spawn(process.execPath, ['--input-type=module','-e',code], {stdio:['pipe','pipe','pipe','pipe'],env:{PATH:process.env.PATH||'/usr/bin:/bin'}});
    let stdout=''; let stderr='';
    child.stdout?.on('data',d=>stdout+=d);
    child.stderr?.on('data',d=>stderr+=d);
    child.on('error',fail);
    child.stdin?.on('error',()=>{});
    child.stdout?.on('error',()=>{});
    child.stderr?.on('error',()=>{});
    child.stdio[3]?.on('error',()=>{});
    child.on('close',exit=>done({code:exit,stdout,stderr}));
    action(child);
  });
}
const start = `import { installParentLivenessWatchdog } from ${JSON.stringify(cliUrl)}; installParentLivenessWatchdog();`;

describe('GE-04 synthetic real-module lifecycle boundary', () => {
  it('worker watchdog exits when parent closes stdin while work is pending', async () => {
    const code = `${start} process.stdout.write('READY\\n'); setInterval(()=>{},1000);`;
    const result = await childRun(code,child=>{
      child.stdout?.once('data',()=>child.stdin?.end());
      (child.stdio[3] as Writable).end('{}');
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('READY');
    expect(result.stderr).not.toContain(canary);
  });
  it('worker exits when parent closes stdin before FD3 payload arrives', async () => {
    const code = `${start} setInterval(()=>{},1000);`;
    const result = await childRun(code,child=>{
      child.stdin?.end();
      (child.stdio[3] as Writable).end();
    });
    expect(result.code).toBe(1);
  });
  it('real credential reader reports truncated synthetic JSON as an error, without echoing secret', async () => {
    const code = `import { readWorkerCredentialSnapshot } from ${JSON.stringify(readerUrl)}; try {readWorkerCredentialSnapshot(3);process.stdout.write('UNEXPECTED')}catch{process.stdout.write('REJECTED')}`;
    const result = await childRun(code,child=>{
      child.stdin?.end();
      (child.stdio[3] as Writable).end('{"test":"'+canary);
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('REJECTED');
    expect(result.stdout+result.stderr).not.toContain(canary);
  });
});
