#!/usr/bin/env node
/**
 * Advisory Codex source-retrieval planner, not a Codex hook or execution gate.
 * Requires GitNexus index identity to match the current repository and branch.
 * Only bounded, literal local source searches are read; no files are modified.
 * An empty/unknown result NEVER establishes absence of dependencies.
 *
 * Usage: node scripts/plan-codex-context.mjs --query "concept" [--path source.ts]
 *        [--root DIR] [--max-files N] [--json]
 */
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { resolve, join, relative, sep, dirname } from "node:path";
// pnpm run may forward a standalone -- separator as a literal script argument.
const args=process.argv.slice(2);
if(args[0]==="--")args.shift();
let root=process.cwd(), query="", maxFiles=8, json=false;
const targets=[];
function error(msg){console.error(msg);process.exit(2);}
for(let i=0;i<args.length;i++){
 const a=args[i];
 if(["--root","--query","--path","--max-files"].includes(a)){
  const val=args[++i];if(!val)error("missing value for "+a);
  if(a==="--root")root=resolve(val);
  if(a==="--query")query=val;
  if(a==="--path")targets.push(val);
  if(a==="--max-files")maxFiles=Number(val);
 }else if(a==="--json")json=true;
 else error("unknown argument: "+a);
}
if(!query.trim()||query.length>500||!Number.isInteger(maxFiles)||maxFiles<1||maxFiles>30)error("invalid query or max-files");
root=realpathSync(root);
const nexus=join(root,".gitnexus","run.cjs");
const scope=join(root,"scripts","check-dox-scope.mjs");
if(!existsSync(scope))error("DOX scope checker unavailable");
const inside=p=>p===root||p.startsWith(root+sep);
const safePath=(candidate)=>{
 if(typeof candidate!=="string"||!candidate||candidate.includes("\0"))return null;
 const full=resolve(root,candidate);
 if(!inside(full))return null;
 let curr=full;
 while(inside(curr)){
  if(existsSync(curr)){
   try{if(!inside(realpathSync(curr)))return null;}catch{return null;}
  }
  if(curr===root)break;
  curr=dirname(curr);
 }
 return relative(root,full);
};
const explicit=[];
for(const t of targets){const path=safePath(t);if(path===null)error("path escapes workspace: "+t);explicit.push(path);}
const run=(bin,argv)=>execFileSync(bin,argv,{cwd:root,encoding:"utf8",timeout:10000,maxBuffer:1024*1024,stdio:["ignore","pipe","pipe"]});
const result={status:"unverified",query,repository:root,gitnexus:{status:"unavailable",indexedCommit:null,currentCommit:null,branch:null},requiredDOX:[],files:[],warnings:[],note:"Advisory retrieval shortlist only. Inspect source and applicable DOX directly; a graph miss or zero callers never establishes safety."};
try{
 const args=[scope,"--json",...(explicit.length?explicit.flatMap(p=>["--path",p]):["--path","."])];
 const out=JSON.parse(run(process.execPath,args));
 if(!out.ok){result.warnings.push("DOX scope preflight failed");result.status="blocked";}
 result.requiredDOX=[...new Set(out.records.flatMap(r=>r.chain))];
 result.instructionBytes=out.maxBytes;
}catch(e){result.status="blocked";result.warnings.push("Cannot verify DOX chain: "+String(e.message).slice(0,150));}
if(result.status!=="blocked"){
 if(!existsSync(nexus)){result.warnings.push("GitNexus runner missing");}
 else {
  try{
   const status=run(process.execPath,[nexus,"status"]);
   const indexed=/Indexed commit:\s*([0-9a-f]+)/i.exec(status)?.[1];
   const current=/Current commit:\s*([0-9a-f]+)/i.exec(status)?.[1];
   const branch=/Branch:\s*([^\r\n]+)/.exec(status)?.[1]?.trim();
   const gitCurrent=run("git",["rev-parse","HEAD"]).trim();
   const gitBranch=run("git",["branch","--show-current"]).trim();
   result.gitnexus={status:"stale",indexedCommit:indexed??null,currentCommit:gitCurrent,branch:gitBranch};
   // Explicitly fail closed on index divergence, detached HEAD, and reported stale status.
   if(!indexed||!current||!branch||!gitBranch||
      !gitCurrent.startsWith(indexed)||!gitCurrent.startsWith(current)||
      branch!==gitBranch||/Status:\s*[^\n]*stale|Workspace index:.*re-run/i.test(status)){
    result.warnings.push("GitNexus index is stale or not bound to this checkout; refresh index before using graph recommendations");
   }else{
    result.gitnexus.status="current";
    const raw=run(process.execPath,[nexus,"query",query,"--repo",".","--limit","5"]);
    const pos=raw.indexOf("{");
    if(pos<0)throw new Error("query output does not include JSON");
    const graph=JSON.parse(raw.slice(pos));
    // Ground exact identifiers in the actual working-tree source, because a graph
    // shortlist can omit the defining file or its dedicated test. This lookup is
    // advisory and runs ONLY after GitNexus freshness has been established.
    const candidates=[...(graph.definitions??[]),...(graph.process_symbols??[])];
    const ranked=[];
    const seen=new Set();
    const add=(candidate,rank)=>{
      const path=safePath(candidate.path);
      if(path===null||seen.has(path)||!existsSync(join(root,path)))return;
      if(!statSync(join(root,path)).isFile())return;
      seen.add(path);
      ranked.push({...candidate,path,priority:rank});
    };
    const identifier=/^[A-Za-z_$][\w$]*$/.test(query);
    const literalIdentifier=query.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    if(identifier){
      try{
        const hits=run("git",["grep","-n","-F","-e",query,"--","src","tests"]);
        const matches=new Map();
        for(const line of hits.split("\n")){
          const match=/^(.+?):([0-9]+):(.*)$/.exec(line);
          if(!match)continue;
          const path=safePath(match[1]);
          if(path===null||!(/\.(?:ts|tsx|js|mjs|cjs)$/.test(path)))continue;
          const text=match[3];
          if(!new RegExp("(^|[^\\w$])"+literalIdentifier+"([^\\w$]|$)").test(text))continue;
          const definition=new RegExp("\\b(?:class|interface|type|function|enum|const|let)\\s+"+literalIdentifier+"\\b").test(text);
          const isTest=/(?:^tests\/|\.(?:test|spec)\.)/.test(path);
          const testStem=query.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase();
          const dedicated=isTest&&new RegExp("(?:^|/)"+testStem+"\\.(?:test|spec)\\.").test(path);
          const rank=definition&&!isTest?0:dedicated?1:isTest?2:3;
          const prev=matches.get(path);
          if(!prev||rank<prev.rank)matches.set(path,{path,rank,startLine:Number(match[2])});
        }
        for(const v of [...matches.values()].sort((a,b)=>a.rank-b.rank||a.path.localeCompare(b.path))){
          add({path:v.path,reason:v.rank===0?"Exact local symbol declaration":v.rank===1?"Dedicated local test references symbol":v.rank===2?"Local test references symbol":"Local source reference (caller/import not independently established)",symbol:query,startLine:v.startLine},v.rank);
        }
      }catch(e){
        if(e.status!==1)result.warnings.push("Local symbol lookup unavailable: "+String(e.message).slice(0,120));
      }
    }else{
      result.warnings.push("Query is not a single identifier; local exact-symbol prioritization skipped");
    }
    for(const def of candidates){
      add({path:def.filePath,reason:"GitNexus candidate (verify directly)",symbol:def.name??null,startLine:def.startLine??null},4);
    }
    result.files=ranked.sort((a,b)=>a.priority-b.priority||a.path.localeCompare(b.path)).slice(0,maxFiles);
    // Discovery may add files outside the operator's initial --path scopes.
    // Recheck the *final* candidate paths, since every returned source must
    // carry its owning DOX chain and must fit the instruction budget.
    if(result.files.length){
      try{
        const candidateArgs=[scope,"--json",...result.files.flatMap(f=>["--path",f.path])];
        const scoped=JSON.parse(run(process.execPath,candidateArgs));
        if(!scoped.ok){
          result.status="blocked";
          result.warnings.push("Candidate DOX scope failed; no shortlist can be trusted");
          result.files=[];
        }else{
          result.requiredDOX=[...new Set([...result.requiredDOX,...scoped.records.flatMap(r=>r.chain)])];
          result.instructionBytes=Math.max(result.instructionBytes??0,scoped.maxBytes??0);
        }
      }catch(e){
        result.status="blocked";
        result.files=[];
        result.warnings.push("Cannot verify candidate DOX chains: "+String(e.message).slice(0,150));
      }
    }
    if(result.status!=="blocked")result.status=result.files.length?"candidates":"unknown";
    if(!result.files.length)result.warnings.push("Graph returned no usable candidate files. This is UNKNOWN, not low risk; use direct source search");
  }
  }catch(e){result.warnings.push("GitNexus unavailable/unverified: "+String(e.message).slice(0,160));}
 }
}
if(!result.files.length && result.status!=="blocked")result.status="unknown";
if(json)console.log(JSON.stringify(result,null,2));
else{
 console.log("Codex context plan: "+result.status+"; graph "+result.gitnexus.status);
 console.log("Required DOX: "+(result.requiredDOX.join(" -> ")||"NOT VERIFIED"));
 for(const file of result.files)console.log("Source candidate: "+file.path+(file.startLine?":"+file.startLine:""));
 for(const warning of result.warnings)console.log("WARNING: "+warning);
 console.log(result.note);
}
process.exit(result.status==="blocked"?1:0);
