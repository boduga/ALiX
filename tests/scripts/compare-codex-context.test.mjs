import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
const cli=new URL("../../scripts/compare-codex-context.mjs",import.meta.url).pathname;
function sample(root,label,model,input,output){
 const file=join(root,label+".jsonl");
 const rows=[
 {type:"session_meta",payload:{id:label}},
 {type:"turn_context",payload:{model}},
 {type:"token_usage_record",payload:{thread_token_usage:{input_tokens:input,cached_input_tokens:input/2,output_tokens:output,total_tokens:input+output}}},
 ];
 writeFileSync(file,rows.map(x=>JSON.stringify(x)).join("\n")+"\n");return file;
}
test("reports matched observations as non-causal",()=>{
 const root=mkdtempSync(join(tmpdir(),"alix-paired-"));
 try{
  const a=sample(root,"baseline","same-model",200,20),b=sample(root,"guided","same-model",100,10);
  const p=spawnSync(process.execPath,[cli,"--baseline",a,"--guided",b,"--json"],{encoding:"utf8"});
  assert.equal(p.status,0,p.stderr);
  const r=JSON.parse(p.stdout);
  assert.equal(r.status,"paired_observation");assert.equal(r.usage.input.pctChange,-50);
  assert.match(r.attribution,/not causal proof/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test("rejects mismatched models without claiming efficiency",()=>{
 const root=mkdtempSync(join(tmpdir(),"alix-paired-"));
 try{
  const a=sample(root,"baseline","model-a",100,1),b=sample(root,"guided","model-b",20,1);
  const p=spawnSync(process.execPath,[cli,"--baseline",a,"--guided",b,"--json"],{encoding:"utf8"});
  assert.equal(p.status,1);assert.equal(JSON.parse(p.stdout).status,"incomparable");
 }finally{rmSync(root,{recursive:true,force:true});}
});
test("rejects same session as matched observation",()=>{
 const root=mkdtempSync(join(tmpdir(),"alix-paired-"));
 try{
  const a=sample(root,"baseline","same-model",100,1);
  const p=spawnSync(process.execPath,[cli,"--baseline",a,"--guided",a],{encoding:"utf8"});
  assert.equal(p.status,2);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test("accepts pnpm-forwarded separator",()=>{
 const root=mkdtempSync(join(tmpdir(),"alix-paired-"));
 try{
  const a=sample(root,"baseline","same-model",100,3),b=sample(root,"guided","same-model",80,4);
  const p=spawnSync(process.execPath,[cli,"--","--baseline",a,"--guided",b,"--json"],{encoding:"utf8"});
  assert.equal(p.status,0,p.stderr);
  assert.equal(JSON.parse(p.stdout).status,"paired_observation");
 }finally{rmSync(root,{recursive:true,force:true});}
});

test("rejects mixed-model cumulative sessions even if the final model matches",()=>{
 const root=mkdtempSync(join(tmpdir(),"alix-paired-"));
 try{
  const a=sample(root,"baseline","model-b",100,5),b=sample(root,"guided","model-b",80,4);
  const original=readFileSync(a,"utf8").trim().split("\n").map(JSON.parse);
  const lines=[
   {type:"session_meta",payload:{id:"baseline"}},
   {type:"turn_context",payload:{model:"model-a"}},
   {type:"token_usage_record",payload:{thread_token_usage:{input_tokens:30,output_tokens:1,total_tokens:31}}},
   ...original.slice(1),
  ];
  writeFileSync(a,lines.map(x=>JSON.stringify(x)).join("\n")+"\n");
  const p=spawnSync(process.execPath,[cli,"--baseline",a,"--guided",b,"--json"],{encoding:"utf8"});
  assert.equal(p.status,1,p.stderr);
  assert.equal(JSON.parse(p.stdout).checks.sameModel,false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test("works when comparator and auditor live in a directory containing spaces",()=>{
 const root=mkdtempSync(join(tmpdir(),"alix path with spaces "));
 try{
  const scripts=join(root,"scripts");mkdirSync(scripts);
  copyFileSync(cli,join(scripts,"compare-codex-context.mjs"));
  copyFileSync(new URL("../../scripts/audit-codex-tokens.mjs",import.meta.url),join(scripts,"audit-codex-tokens.mjs"));
  const a=sample(root,"baseline","same-model",100,5),b=sample(root,"guided","same-model",80,4);
  const p=spawnSync(process.execPath,[join(scripts,"compare-codex-context.mjs"),"--baseline",a,"--guided",b,"--json"],{encoding:"utf8"});
  assert.equal(p.status,0,p.stderr);
  assert.equal(JSON.parse(p.stdout).status,"paired_observation");
 }finally{rmSync(root,{recursive:true,force:true});}
});

test("refuses incomplete cumulative usage instead of reporting phantom savings",()=>{
 const root=mkdtempSync(join(tmpdir(),"alix-paired-"));
 try{
  const a=sample(root,"baseline","same-model",100,20),b=sample(root,"guided","same-model",80,10);
  const records=readFileSync(b,"utf8").trim().split("\n").map(JSON.parse);
  records[2].payload.thread_token_usage={input_tokens:80};
  writeFileSync(b,records.map(JSON.stringify).join("\n")+"\n");
  const p=spawnSync(process.execPath,[cli,"--baseline",a,"--guided",b,"--json"],{encoding:"utf8"});
  assert.equal(p.status,1,p.stderr);
  const result=JSON.parse(p.stdout);
  assert.equal(result.checks.bothMeasured,false);
  assert.equal(result.status,"incomparable");
  assert.equal(result.usage.total.guided,null);
  assert.equal(result.usage.total.difference,null);
  assert.equal(result.usage.total.pctChange,null);
 }finally{rmSync(root,{recursive:true,force:true});}
});
