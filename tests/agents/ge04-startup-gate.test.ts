import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const modulePath=resolve(fileURLToPath(import.meta.url),'../../../src/agents/worker-supervisor-startup-gate.js');
function run(marker:string):Promise<number|null>{
 return new Promise((done,reject)=>{
  const child=spawn(process.execPath,['--input-type=module','-e',`import {awaitSupervisorStartupRelease} from ${JSON.stringify('file://'+modulePath)};awaitSupervisorStartupRelease(4);`],{stdio:['ignore','ignore','pipe','ignore','pipe']});
  child.on('error',reject);child.on('exit',done);
  const pipe=child.stdio[4];
  if(!pipe || !('end' in pipe))throw new Error('no gate');
  pipe.end(marker);
 });
}
test('GE-04 startup gate accepts exact parent release',async()=>{assert.equal(await run('GE04_READY\n'),0)});
test('GE-04 startup gate denies EOF',async()=>{assert.notEqual(await run(''),0)});
test('GE-04 startup gate denies forged marker',async()=>{assert.notEqual(await run('GE04_READY\nEXTRA'),0)});
