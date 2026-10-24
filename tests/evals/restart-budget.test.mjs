import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
test('restart cap validation, running-worker kill, and cumulative usage survive crash/resume', () => {
const root=mkdtempSync(join(tmpdir(),'restart-check-'));
try {
const dir=join(root,'benchmark/evidence/coordination'); mkdirSync(dir,{recursive:true}); mkdirSync(join(root,'bin'));
const script=join(dir,'run-restart-metered.mjs');copyFileSync(fileURLToPath(new URL('../../benchmark/evidence/coordination/run-restart-metered.mjs', import.meta.url)),script);
writeFileSync(join(root,'bin/alix.js'), `const fs=require('node:fs'); const p=require('node:path'); const dir='.alix/coordination'; fs.mkdirSync(dir,{recursive:true}); fs.mkdirSync('.alix/sessions/test',{recursive:true}); const resume=process.argv.includes('resume'); fs.writeFileSync(p.join(dir,'coord_123.json'),JSON.stringify({id:'coord_123',status:resume?'completed':'running',workers:[{id:'worker',status:resume?'completed':'running',attempt:resume?2:1}]})); fs.appendFileSync('.alix/sessions/test/events.jsonl',JSON.stringify({type:'model.usage',sessionId:'test',payload:{inputTokens:resume?20:10,outputTokens:resume?2:1}})+'\\n'); if(!resume)setInterval(()=>{},1000);`);
mkdirSync(join(dir,'restart-workspace'));writeFileSync(join(dir,'restart-workspace/sentinel'),'keep');
for(const cap of ['0','-1','1.2','bad','9007199254740992',null]){
 const args=[script,'--output-cap',...(cap===null?[]:[cap])];
 const result=spawnSync(process.execPath,args,{encoding:'utf8'}); assert.equal(result.status,2);assert.equal(readFileSync(join(dir,'restart-workspace/sentinel'),'utf8'),'keep');
}
for(const cap of [null,'2048']){
 const out=join(root,'result.json'); const args=[script,'--provider','fixture','--model','fixture','--kill-on-running','--out',out,...(cap?['--output-cap',cap]:[])];
 const result=spawnSync(process.execPath,args,{encoding:'utf8',timeout:10000});assert.equal(result.status,0,result.stderr);
 const data=JSON.parse(readFileSync(out));assert.equal(data.usage.inputTokens,30);assert.equal(data.usage.outputTokens,3);assert.equal(data.usage.records.length,2);assert.equal(data.phase1.usageRecords,1);assert.equal(data.killOnRunning,true);assert.equal(data.phase1.killState.killed,true);assert.equal(data.phase1.killState.trigger.workerId,'worker');assert.equal(data.outputCapOverride,cap?2048:null);
 const config=JSON.parse(readFileSync(join(dir,'restart-workspace/.alix/config.json')));assert.deepEqual(config.context.budget,cap?{outputCap:2048}:undefined);
}
writeFileSync(join(root,'bin/alix.js'),'process.exit(0)');
const earlyOut=join(root,'early.json');const early=spawnSync(process.execPath,[script,'--provider','fixture','--model','fixture','--kill-on-running','--out',earlyOut],{encoding:'utf8',timeout:10000});assert.equal(early.status,0);const earlyData=JSON.parse(readFileSync(earlyOut));assert.equal(earlyData.phase1.killState.killed,false);assert.equal(earlyData.phase2.resumedRunId,null);

} finally {rmSync(root,{recursive:true,force:true});}

});
