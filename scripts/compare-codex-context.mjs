#!/usr/bin/env node
/**
 * Read-only paired Codex context benchmark; does not launch model runs.
 * Compares matched session counters, not plugin-attributed savings.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
const argv=process.argv.slice(2);
if(argv[0]==="--")argv.shift();
let baseline, guided, json=false;
for(let i=0;i<argv.length;i++){
 const arg=argv[i];
 if(arg==="--baseline" && argv[i+1])baseline=resolve(argv[++i]);
 else if(arg==="--guided" && argv[i+1])guided=resolve(argv[++i]);
 else if(arg==="--json")json=true;
 else {console.error("usage: compare-codex-context.mjs --baseline LOG --guided LOG [--json]");process.exit(2);}
}
if(!baseline||!guided||baseline===guided){console.error("distinct --baseline and --guided JSONL files required");process.exit(2);}
function audit(file){
 const p=spawnSync(process.execPath,[new URL("./audit-codex-tokens.mjs", import.meta.url).pathname,"--file",file,"--json"],{encoding:"utf8",timeout:20000});
 if(p.status!==0)throw new Error(p.stderr.trim()||"audit failed");
 return JSON.parse(p.stdout);
}
let a,b;try{a=audit(baseline);b=audit(guided);}catch(e){console.error(String(e.message));process.exit(2);}
const sameModel=Boolean(a.model&&b.model&&a.model===b.model);
const bothMeasured=a.tokenUsageRecords>0&&b.tokenUsageRecords>0&&a.tokenUsage.input_tokens>0&&b.tokenUsage.input_tokens>0;
const checks={sameModel,bothMeasured,distinctSessions: Boolean(a.sessionId&&b.sessionId&&a.sessionId!==b.sessionId)};
const eligible=Object.values(checks).every(Boolean);
const metric=name=>{
 const before=a.tokenUsage[name],after=b.tokenUsage[name];
 return {baseline:before,guided:after,difference:after-before,pctChange:before?Number(((after-before)/before*100).toFixed(2)):null};
};
const report={
 status:eligible?"paired_observation":"incomparable",
 checks,
 baseline:{source:a.source,sessionId:a.sessionId,model:a.model,turns:a.turns,toolCalls:a.toolCalls,compactions:a.compactions},
 guided:{source:b.source,sessionId:b.sessionId,model:b.model,turns:b.turns,toolCalls:b.toolCalls,compactions:b.compactions},
 usage:{input:metric("input_tokens"),cachedInput:metric("cached_input_tokens"),output:metric("output_tokens"),total:metric("total_tokens")},
 attribution:"Paired observations are not causal proof. Different retrieval instructions, session history, caching, model routing, plugin actions or answer quality can explain changes. Compare answer accuracy and missed callers manually. RTK and TokenEconomizer metrics are NOT added.",
};
if(json)console.log(JSON.stringify(report,null,2));
else{
 console.log("Codex paired context comparison: "+report.status);
 console.log("Checks: "+JSON.stringify(checks));
 for(const [k,v] of Object.entries(report.usage))console.log(k+": "+v.baseline+" -> "+v.guided+" ("+(v.pctChange===null?"n/a":v.pctChange+"%")+")");
 console.log(report.attribution);
}
process.exit(eligible?0:1);
