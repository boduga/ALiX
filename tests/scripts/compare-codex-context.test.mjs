import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
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
