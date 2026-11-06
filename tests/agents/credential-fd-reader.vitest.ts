import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import type { Writable } from 'node:stream';
import { readWorkerCredentialSnapshot } from '../../src/agents/credential-fd-reader.js';

describe('coordination credential FD reader', () => {
  it('does not read invalid descriptor numbers', () => {
    expect(readWorkerCredentialSnapshot(NaN)).toBeUndefined();
    expect(readWorkerCredentialSnapshot(2)).toBeUndefined();
  });
  it('reads synthetic payload from actual child FD3 without leaking it to stdout', async () => {
    const marker = 'synthetic-ge04-only';
    const moduleUrl = pathToFileURL(resolve(process.cwd(), 'dist/src/agents/credential-fd-reader.js')).href;
    const code = `import { readWorkerCredentialSnapshot } from ${JSON.stringify(moduleUrl)}; const x=readWorkerCredentialSnapshot(3); process.stdout.write(JSON.stringify({matches:x?.test===${JSON.stringify(marker)}, filtered:x?.invalid===undefined}));`;
    const result = await new Promise<{code:number|null;stdout:string}>((resolve,reject)=>{
      const child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['ignore','pipe','pipe','pipe']});
      let stdout=''; child.stdout?.on('data',x=>stdout+=x);
      child.on('error',reject); child.on('close',code=>resolve({code,stdout}));
      const fd3 = child.stdio[3] as Writable | null;
      fd3?.on('error',()=>{});
      fd3?.end(JSON.stringify({test:marker,invalid:123}));
    });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({matches:true,filtered:true});
    expect(result.stdout).not.toContain(marker);
  });
});
