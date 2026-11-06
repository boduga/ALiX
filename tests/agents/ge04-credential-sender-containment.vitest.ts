import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Writable } from 'node:stream';
import { planWorkerCredentialGrant } from '../../src/agents/credential-grant-planner.js';
import { projectSyntheticCredentialSnapshot } from '../../src/agents/credential-grant-fixture.js';

const marker = 'ge04-synthetic-excluded-canary';
const keys = Object.freeze({openai:'ge04-synthetic-primary',anthropic:'ge04-synthetic-fallback',google:marker});
const reader = pathToFileURL(resolve(process.cwd(),'dist/src/agents/credential-fd-reader.js')).href;

function sendToRealReader(payload: string, terminateEarly = false): Promise<{code:number|null; stdout:string; stderr:string}> {
  const code = `import {readWorkerCredentialSnapshot} from ${JSON.stringify(reader)}; ${terminateEarly ? "process.exit(0);" : "const x=readWorkerCredentialSnapshot(3); process.stdout.write(JSON.stringify({providers:Object.keys(x??{}),excluded:Object.values(x??{}).includes('ge04-synthetic-excluded-canary')}));"}`;
  return new Promise((done,fail)=>{
    const child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['ignore','pipe','pipe','pipe']});
    let stdout='';let stderr='';
    child.stdout?.on('data',chunk=>stdout+=chunk);
    child.stderr?.on('data',chunk=>stderr+=chunk);
    child.on('error',fail);
    (child.stdio[3] as Writable).on('error',()=>{});
    (child.stdio[3] as Writable).end(payload);
    child.on('close',exit=>done({code:exit,stdout,stderr}));
  });
}

describe('GE-04 Q3.3 synthetic sender containment (not production)',()=>{
  it('real compiled FD3 reader receives primary only, never unrelated canary',async()=>{
    const plan=planWorkerCredentialGrant({provider:'openai',name:'synthetic'});
    const payload=projectSyntheticCredentialSnapshot(plan,keys,['openai']);
    expect(payload).not.toContain(marker);
    const result=await sendToRealReader(payload);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({providers:['openai'],excluded:false});
    expect(result.stdout+result.stderr).not.toContain(marker);
  });
  it('includes explicitly authorized fallback but excludes third provider',async()=>{
    const plan=planWorkerCredentialGrant({provider:'openai',name:'synthetic',routing:{fallbacks:[{provider:'anthropic',name:'synthetic'}]}});
    const payload=projectSyntheticCredentialSnapshot(plan,keys,['openai','anthropic']);
    expect(payload).not.toContain(marker);
    const result=await sendToRealReader(payload);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({providers:['openai','anthropic'],excluded:false});
  });
  it('rejects unauthorized expansion and malformed grant',()=>{
    const plan=planWorkerCredentialGrant({provider:'openai',name:'synthetic'});
    expect(()=>projectSyntheticCredentialSnapshot({providers:['openai','google']},keys,plan.providers)).toThrow();
    expect(()=>projectSyntheticCredentialSnapshot({providers:['openai','openai']},keys,plan.providers)).toThrow();
    expect(()=>projectSyntheticCredentialSnapshot({providers:['openai','../google']},keys,plan.providers)).toThrow();
    expect(()=>projectSyntheticCredentialSnapshot({providers:['openai']},keys,['openai','anthropic'])).toThrow();
  });
  it('early child exit cannot echo excluded canary',async()=>{
    const plan=planWorkerCredentialGrant({provider:'openai',name:'synthetic'});
    const result=await sendToRealReader(projectSyntheticCredentialSnapshot(plan,keys,plan.providers),true);
    expect(result.code).toBe(0);
    expect(result.stdout+result.stderr).not.toContain(marker);
  });
});
