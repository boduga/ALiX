import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";

const script = new URL("../../scripts/audit-dox-overlap.mjs",import.meta.url).pathname;
const long = "- **Owned-path authorization.** Enforce containment through canonical owned path matching and explicit authorization checks before mutating the workspace.";
function fixture(files) {
 const root=mkdtempSync(join(tmpdir(),"alix-dox-overlap-"));
 for(const [name,body] of Object.entries(files)){const p=join(root,name);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,body);}
 return root;
}
function run(root,...args){
 const p=spawnSync(process.execPath,[script,"--root",root,"--json",...args],{encoding:"utf8"});
 return {status:p.status,data:p.status===0?JSON.parse(p.stdout):null,stderr:p.stderr};
}
test("detects exact ancestor repetition but not unrelated siblings",()=>{
 const root=fixture({"AGENTS.md":long+"\n","src/a/AGENTS.md":long+"\n","src/b/AGENTS.md":long+"\n"});
 try {
  const r=run(root);
  assert.equal(r.status,0,r.stderr); assert.equal(r.data.exactAncestorBullets,2);
  assert.equal(r.data.potentialSemanticOverlaps,0);
  assert.equal(r.data.filesScanned,3);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test("scores similar but not identical ancestor contracts as review candidates",()=>{
 const root=fixture({"AGENTS.md":long+"\n","src/AGENTS.md":long.replace("explicit authorization checks","mandatory authorization checks")+"\n"});
 try {
  const r=run(root,"--threshold","0.5");
  assert.equal(r.status,0,r.stderr);
  assert.equal(r.data.exactAncestorBullets,0);
  assert.equal(r.data.potentialSemanticOverlaps,1);
  assert.equal(r.data.status,"advisory");
 }finally{rmSync(root,{recursive:true,force:true});}
});
test("siblings are not in the same inherited instruction chain",()=>{
 const root=fixture({"AGENTS.md":"# DOX","a/AGENTS.md":long,"b/AGENTS.md":long});
 try {const r=run(root);assert.equal(r.status,0);assert.equal(r.data.exactAncestorBullets,0);}
 finally{rmSync(root,{recursive:true,force:true});}
});
test("short bullets do not count as duplicate contracts",()=>{
 const root=fixture({"AGENTS.md":"- **Same.** tiny","src/AGENTS.md":"- **Same.** tiny"});
 try {const r=run(root);assert.equal(r.status,0);assert.equal(r.data.exactAncestorBullets,0);}
 finally{rmSync(root,{recursive:true,force:true});}
});
test("invalid thresholds produce invocation error",()=>{
 const root=fixture({"AGENTS.md":"# DOX"});
 try {const p=spawnSync(process.execPath,[script,"--root",root,"--threshold","2"],{encoding:"utf8"});assert.equal(p.status,2);}
 finally{rmSync(root,{recursive:true,force:true});}
});
