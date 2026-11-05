'use strict';
// Synthetic canary only; no ALiX configuration or real credentials loaded.
const {spawn}=require('node:child_process');
const {openSync,closeSync,mkdtempSync,writeFileSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {randomUUID}=require('node:crypto');
const base={gate:'GE04_Q32_CREDENTIAL_FD_FIXTURE',disposition:'HOLD',qualified_independent_issuance:false,real_effects_performed:0};
if(process.argv[2]!=='--isolated-test'||process.platform!=='linux'||process.getuid?.()===0){console.log(JSON.stringify({...base,reason:'nonroot Linux opt-in required'}));process.exit(78)}
const dir=mkdtempSync(join(tmpdir(),'ge04-fd3-'));const file=join(dir,'canary');const fd=openSync(file,'w+');writeFileSync(fd,'synthetic-only');const token=`synthetic-${randomUUID()}`;
const childCode=`const fs=require('node:fs');const fd=Number(process.argv[1]);let value='';try{value=fs.readFileSync(fd,'utf8')}catch{};const result={received:value.length>0,matching:value===process.argv[2],fd3_nonregular:(()=>{try{return !fs.fstatSync(3).isFile()}catch{return false}})(),fd9_regular:(()=>{try{return fs.fstatSync(9).isFile()}catch{return false}})()};process.stdout.write(JSON.stringify(result));`;
function run(mode){return new Promise(resolve=>{const c=spawn(process.execPath,['-e',childCode,'3',token],{stdio:['ignore','pipe','pipe','pipe'],env:{PATH:process.env.PATH||'/usr/bin:/bin'}});let out='';c.stdout.on('data',x=>out+=x);c.on('error',()=>resolve(null));c.on('close',()=>{try{resolve(JSON.parse(out))}catch{resolve(null)}});c.stdio[3].on('error',()=>{});if(mode==='send')c.stdio[3].end(token);else c.stdio[3].end();})}
(async()=>{try{const sent=await run('send');const empty=await run('empty');const checks={synthetic_payload_delivered:sent?.matching===true,fd3_is_nonregular:sent?.fd3_nonregular===true,unrelated_fd9_not_regular:sent?.fd9_regular===false,empty_pipe_no_payload:empty?.received===false};console.log(JSON.stringify({...base,checks,all_expected:Object.values(checks).every(Boolean),limits:'synthetic_Node_worker_not_actual_ALiX_child; no parent-death, cross-UID, or credential-minimization qualification'}))}catch{console.log(JSON.stringify({...base,all_expected:false}))}finally{closeSync(fd);rmSync(dir,{recursive:true,force:true})}process.exitCode=78})();
