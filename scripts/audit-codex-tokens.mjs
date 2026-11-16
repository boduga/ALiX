#!/usr/bin/env node
/**
 * Read-only Codex token observability. Report only measured counters;
 * RTK and TokenEconomizer totals are separate, non-additive measurements.
 * Do not infer causal context-planner savings from a session snapshot.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
const args=process.argv.slice(2);
let file=null, sessionsDir=join(homedir(),".codex","sessions"), json=false;
for(let i=0;i<args.length;i++){
 const a=args[i],v=args[i+1];
 if(a==="--file"&&v){file=resolve(v);i++;}
 else if(a==="--sessions-dir"&&v){sessionsDir=resolve(v);i++;}
 else if(a==="--json")json=true;
 else {console.error("usage: audit-codex-tokens.mjs [--file JSONL] [--sessions-dir DIR] [--json]");process.exit(2);}
}
function recent(dir) {
 let best=null;
 function walk(p,depth){
  if(depth>5||!existsSync(p))return;
  for(const e of readdirSync(p,{withFileTypes:true})){
   const q=join(p,e.name);
   if(e.isSymbolicLink())continue;
   if(e.isDirectory())walk(q,depth+1);
   else if(e.isFile()&&e.name.endsWith(".jsonl")&&(!best||statSync(q).mtimeMs>statSync(best).mtimeMs))best=q;
  }
 }
 walk(dir,0);return best;
}
file??=recent(sessionsDir);
if(!file||!existsSync(file)){console.error("no Codex JSONL session found");process.exit(2);}
const totals={input_tokens:null,cached_input_tokens:null,cache_write_input_tokens:null,output_tokens:null,reasoning_output_tokens:null,total_tokens:null};
const keys=Object.keys(totals);
let samples=0,responseUsageRecords=0,compactions=0,toolCalls=0,toolOutputs=0,turns=0,model=null,sessionId=null;
const modelsSeen=new Set();
let invalid=0;
for(const line of readFileSync(file,"utf8").split(/\r?\n/)){
 if(!line.trim())continue;
 let x;try{x=JSON.parse(line);}catch{invalid++;continue;}
 const p=x.payload??{};
 if(x.type==="session_meta")sessionId=p.id??null;
 if(x.type==="turn_context"){turns++;if(typeof p.model==="string" && p.model.trim()){model=p.model;modelsSeen.add(p.model);}}
 if(x.type==="compacted")compactions++;
 if(x.type==="response_item"){
  if(p.type==="function_call"||p.type==="custom_tool_call")toolCalls++;
  if(p.type==="function_call_output"||p.type==="custom_tool_call_output")toolOutputs++;
 }
 if(x.type==="token_usage_record"){
  // Response-level usage is not a cumulative session snapshot. Mixing it
  // with thread totals would invent a complete session from a final response.
  const u=p.thread_token_usage;
  if(!u||typeof u!=="object"){
    if(p.usage)responseUsageRecords++;
    continue;
  }
  samples++;
  // Last thread-level total is cumulative; never sum successive records.
  for(const k of keys)totals[k]=Number.isFinite(u[k])?u[k]:null;
 }
}
const modelHistory=[...modelsSeen];
const missingCounters=keys.filter(k=>totals[k]===null);
const report={source:file,sessionId,model,modelHistory,mixedModels:modelHistory.length>1,missingCounters,turns,tokenUsageRecords:samples,responseUsageRecords,tokenUsage:totals,compactions,toolCalls,toolOutputs,invalidLines:invalid,attribution:{
 codex:"Recorded cumulative session counters (not a controlled baseline)",
 rtk:"Inspect 'rtk gain -p --format json' separately; its estimated savings are not additive with Codex billed usage",
 tokenEconomizer:"Configured hooks may affect context; no per-hook savings attributed from Codex JSONL",
 contextPlanner:"No causal savings measured; requires matched tasks, models, and toggled retrieval experiments"
}};
if(json)console.log(JSON.stringify(report,null,2));
else{
 console.log("Codex session: "+(sessionId??"unknown")+" model: "+(model??"unknown"));
 console.log("Recorded tokens: input "+totals.input_tokens+", cached input "+totals.cached_input_tokens+", output "+totals.output_tokens+", total "+totals.total_tokens);
 console.log("Turns "+turns+"; tool calls "+toolCalls+"; tool outputs "+toolOutputs+"; compactions "+compactions+"; records "+samples);
 console.log("Attribution: RTK, TokenEconomizer and planner effects NOT separable from this session log.");
}
