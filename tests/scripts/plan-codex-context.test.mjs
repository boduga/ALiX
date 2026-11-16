import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync,mkdirSync,writeFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname,join } from "node:path";
import { spawnSync } from "node:child_process";
const script=new URL("../../scripts/plan-codex-context.mjs",import.meta.url).pathname;
const scope=new URL("../../scripts/check-dox-scope.mjs",import.meta.url).pathname;
function write(root,p,s){mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),s);}
function git(root,...args){const r=spawnSync("git",args,{cwd:root,encoding:"utf8"});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
function setup(mode="current"){
 const root=mkdtempSync(join(tmpdir(),"alix-codex-plan-"));
 write(root,"AGENTS.md","# Root DOX\n");
 write(root,"src/AGENTS.md","# Src DOX\n");
 write(root,"src/sample.ts","export const testSymbol=1;\n");
 write(root,"tests/test-symbol.test.ts",'import {testSymbol} from "../src/sample.js";\nvoid testSymbol;\n');
 write(root,"src/ref.ts",'import {testSymbol} from "./sample.js";\nvoid testSymbol;\n');
 write(root,"scripts/check-dox-scope.mjs", "import "+JSON.stringify(scope)+";"); // wrapper below
 write(root,"scripts/check-dox-scope.mjs",`import {spawnSync} from "node:child_process"; const r=spawnSync(process.execPath,[${JSON.stringify(scope)},...process.argv.slice(2)],{encoding:"utf8"});process.stdout.write(r.stdout);process.stderr.write(r.stderr);process.exit(r.status??2);\n`);
 git(root,"init","-q","-b","main");git(root,"config","user.email","test@example.test");git(root,"config","user.name","Fixture");
 git(root,"add",".");git(root,"commit","-qm","fixture");
 const commit=git(root,"rev-parse","--short","HEAD");
 const indexed=mode==="stale"?"0000000":commit;
 const fake=`const a=process.argv.slice(2); if(a[0]==="status")console.log("GitNexus Status\\nBranch: main\\nIndexed commit: ${indexed}\\nCurrent commit: ${commit}\\nStatus: ${mode==="stale"?"stale":"current"}");else if(a[0]==="query")console.log('GitNexus Query\\n'+JSON.stringify({definitions:[{name:"testSymbol",filePath:"src/sample.ts",startLine:1},{name:"outside",filePath:"../outside.ts"}]})); else process.exit(2);\n`;
 write(root,".gitnexus/run.cjs",fake);
 return root;
}
function run(root,...args){
 const r=spawnSync(process.execPath,[script,"--root",root,"--query","testSymbol","--json",...args],{encoding:"utf8",timeout:10000});
 return {code:r.status,out:r.stdout?JSON.parse(r.stdout):null,stderr:r.stderr};
}
test("stale graph emits required DOX without source candidates",()=>{
 const root=setup("stale");
 try{const r=run(root,"--path","src/sample.ts");assert.equal(r.code,0,r.stderr);assert.equal(r.out.status,"unknown");assert.equal(r.out.files.length,0);assert.deepEqual(r.out.requiredDOX,["AGENTS.md","src/AGENTS.md"]);}
 finally{rmSync(root,{recursive:true,force:true});}
});
test("fresh graph yields bounded inside-workspace candidates",()=>{
 const root=setup("current");
 try{const r=run(root,"--path","src/sample.ts","--max-files","1");assert.equal(r.code,0,r.stderr);assert.equal(r.out.status,"candidates");assert.deepEqual(r.out.files.map(x=>x.path),["src/sample.ts"]);assert.equal(r.out.gitnexus.status,"current");}
 finally{rmSync(root,{recursive:true,force:true});}
});
test("invalid target rejects workspace escape",()=>{
 const root=setup();
 try{const r=run(root,"--path","../outside.ts");assert.equal(r.code,2);}
 finally{rmSync(root,{recursive:true,force:true});}
});
test("invalid bounded result size fails",()=>{
 const root=setup();
 try{const r=run(root,"--max-files","10000");assert.equal(r.code,2);}
 finally{rmSync(root,{recursive:true,force:true});}
});

test("accepts pnpm-style leading double-dash separator",()=>{
 const root=setup("stale");
 try {
  const direct=run(root,"--path","src/sample.ts");
  const separated=spawnSync(process.execPath,[script,"--","--root",root,"--query","sample","--json","--path","src/sample.ts"],{encoding:"utf8",timeout:10000});
  assert.equal(separated.status,0,separated.stderr);
  const parsed=JSON.parse(separated.stdout);
  assert.deepEqual(parsed.requiredDOX,direct.out.requiredDOX);
  assert.equal(parsed.status,direct.out.status);
 } finally {rmSync(root,{recursive:true,force:true});}
});

test("prioritizes local exact definition and dedicated test ahead of graph-only candidates",()=>{
 const root=setup("current");
 try{
  const p=spawnSync(process.execPath,[script,"--root",root,"--query","testSymbol","--json","--path","src/sample.ts","--max-files","2"],{encoding:"utf8",timeout:10000});
  assert.equal(p.status,0,p.stderr);
  const result=JSON.parse(p.stdout);
  assert.deepEqual(result.files.map(x=>x.path),["src/sample.ts","tests/test-symbol.test.ts"]);
  assert.deepEqual(result.files.map(x=>x.priority),[0,1]);
  assert.match(result.files[0].reason,/Exact local symbol declaration/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test("stale graph never runs local prioritization even if local matches exist",()=>{
 const root=setup("stale");
 try{
  const p=spawnSync(process.execPath,[script,"--root",root,"--query","testSymbol","--json","--path","src/sample.ts"],{encoding:"utf8",timeout:10000});
  assert.equal(p.status,0,p.stderr);
  const result=JSON.parse(p.stdout);
  assert.equal(result.status,"unknown");
  assert.deepEqual(result.files,[]);
 }finally{rmSync(root,{recursive:true,force:true});}
});
