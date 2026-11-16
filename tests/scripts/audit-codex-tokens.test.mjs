import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
const script = new URL("../../scripts/audit-codex-tokens.mjs", import.meta.url).pathname;
const record = (type, payload) => JSON.stringify({type,payload})+"\n";
const usage = (input, cached, output) => ({
 input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0,
 output_tokens: output, reasoning_output_tokens: 1, total_tokens: input+output
});
function fixture(content, rel="2026/11/15/session.jsonl") {
 const root=mkdtempSync(join(tmpdir(),"alix-codex-tokens-"));
 const file=join(root,rel);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,content);
 return {root,file};
}
function run(...args) {
 const p=spawnSync(process.execPath,[script,"--json",...args],{encoding:"utf8"});
 return {status:p.status,stdout:p.stdout,stderr:p.stderr,result:p.status===0?JSON.parse(p.stdout):null};
}
test("uses last cumulative thread counter without summing snapshots",()=>{
 const content=record("session_meta",{id:"test-session"})+record("turn_context",{model:"fixture-model"})+
 record("token_usage_record",{thread_token_usage:usage(100,20,10)})+
 record("token_usage_record",{thread_token_usage:usage(190,80,15)})+
 record("response_item",{type:"function_call"})+
 record("response_item",{type:"function_call_output"})+
 record("compacted",{});
 const {root,file}=fixture(content);
 try {
  const r=run("--file",file);
  assert.equal(r.status,0,r.stderr);
  assert.equal(r.result.tokenUsage.input_tokens,190);
  assert.equal(r.result.tokenUsage.cached_input_tokens,80);
  assert.equal(r.result.tokenUsage.total_tokens,205);
  assert.equal(r.result.tokenUsageRecords,2);
  assert.equal(r.result.compactions,1);
  assert.equal(r.result.toolCalls,1);
  assert.equal(r.result.toolOutputs,1);
  assert.equal(r.result.model,"fixture-model");
 }finally{rmSync(root,{recursive:true,force:true});}
});
test("does not count usage and thread usage from one record twice",()=>{
 const {root,file}=fixture(record("token_usage_record",{usage:usage(10,0,1),thread_token_usage:usage(20,5,2)}));
 try{const r=run("--file",file);assert.equal(r.status,0);assert.equal(r.result.tokenUsage.total_tokens,22);}
 finally{rmSync(root,{recursive:true,force:true});}
});
test("detects corrupted JSONL without fabricating events",()=>{
 const {root,file}=fixture("broken-json\n"+record("token_usage_record",{usage:usage(1,0,0)}));
 try{const r=run("--file",file);assert.equal(r.status,0);assert.equal(r.result.invalidLines,1);}
 finally{rmSync(root,{recursive:true,force:true});}
});
test("discovers newest session in recursive dated directories",()=>{
 const {root}=fixture(record("session_meta",{id:"found"}));
 try{const r=run("--sessions-dir",root);assert.equal(r.status,0);assert.equal(r.result.sessionId,"found");}
 finally{rmSync(root,{recursive:true,force:true});}
});
test("missing session and malformed options are invocation errors",()=>{
 const root=mkdtempSync(join(tmpdir(),"alix-codex-empty-"));
 try{assert.equal(run("--sessions-dir",root).status,2);assert.equal(run("--bogus").status,2);}
 finally{rmSync(root,{recursive:true,force:true});}
});
test("report explicitly disclaims RTK and TokenEconomizer attribution",()=>{
 const {root,file}=fixture(record("token_usage_record",{usage:usage(30,5,3)}));
 try{
  const r=run("--file",file);
  assert.equal(r.status,0);
  assert.match(r.result.attribution.rtk,/not additive/);
  assert.match(r.result.attribution.tokenEconomizer,/no per-hook savings/);
  assert.match(r.result.attribution.contextPlanner,/No causal savings/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test("counts custom tool calls and outputs alongside function calls",()=>{
 const content=record("turn_context",{model:"same"})+
  record("response_item",{type:"function_call"})+
  record("response_item",{type:"custom_tool_call"})+
  record("response_item",{type:"function_call_output"})+
  record("response_item",{type:"custom_tool_call_output"});
 const {root,file}=fixture(content);
 try{const r=run("--file",file);assert.equal(r.status,0);assert.equal(r.result.toolCalls,2);assert.equal(r.result.toolOutputs,2);}
 finally{rmSync(root,{recursive:true,force:true});}
});
test("reports every observed model rather than hiding a mid-session model switch",()=>{
 const {root,file}=fixture(record("turn_context",{model:"model-a"})+record("turn_context",{model:"model-b"})+
  record("token_usage_record",{thread_token_usage:usage(80,20,5)}));
 try{const r=run("--file",file);assert.equal(r.status,0);assert.equal(r.result.model,"model-b");assert.deepEqual(r.result.modelHistory,["model-a","model-b"]);assert.equal(r.result.mixedModels,true);}
 finally{rmSync(root,{recursive:true,force:true});}
});

test("missing cumulative counters remain unknown, not fabricated zero",()=>{
 const {root,file}=fixture(record("session_meta",{id:"missing"})+
 record("turn_context",{model:"same"})+
 record("token_usage_record",{thread_token_usage:usage(100,20,10)})+
 record("token_usage_record",{thread_token_usage:{input_tokens:110}}));
 try{
  const r=run("--file",file);
  assert.equal(r.status,0,r.stderr);
  assert.equal(r.result.tokenUsage.input_tokens,110);
  assert.equal(r.result.tokenUsage.output_tokens,null);
  assert.equal(r.result.tokenUsage.total_tokens,null);
  assert.equal(r.result.tokenUsage.cached_input_tokens,null);
  assert(r.result.missingCounters.includes("total_tokens"));
 }finally{rmSync(root,{recursive:true,force:true});}
});
