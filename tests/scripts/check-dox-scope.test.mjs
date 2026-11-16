import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";

const script = new URL("../../scripts/check-dox-scope.mjs", import.meta.url).pathname;
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "alix-dox-scope-"));
  for (const [name, data] of Object.entries(files)) {
    const file = join(root, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, data);
  }
  return root;
}
function run(root, ...args) {
  const p = spawnSync(process.execPath, [script, "--root", root, "--json", ...args], { encoding: "utf8" });
  return { status: p.status, data: JSON.parse(p.stdout), stderr: p.stderr };
}
const config = "project_doc_max_bytes = 1024\n[projects.test]\ntrust_level = \"trusted\"\n";
test("scoped chain includes ancestors, excludes unrelated sibling", () => {
  const root = fixture({ "AGENTS.md": "root", "src/AGENTS.md": "parent", "src/a/AGENTS.md": "child", "src/b/AGENTS.md": "sibling", "codex.toml": config });
  try {
    const r = run(root, "--config", join(root, "codex.toml"), "--path", "src/a/file.ts");
    assert.equal(r.status, 0);
    assert.deepEqual(r.data.records[0].chain, ["AGENTS.md", "src/AGENTS.md", "src/a/AGENTS.md"]);
    assert.equal(r.data.budget, 1024);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("overflow is a failing verdict", () => {
  const root = fixture({ "AGENTS.md": "a".repeat(90), "src/AGENTS.md": "b".repeat(90) });
  try {
    const r = run(root, "--budget", "128", "--path", "src/x.ts");
    assert.equal(r.status, 1);
    assert.equal(r.data.findings[0].type, "budget_overflow");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("all mode checks every instruction chain", () => {
  const root = fixture({ "AGENTS.md": "root", "a/AGENTS.md": "a", "b/AGENTS.md": "b" });
  try {
    const r = run(root, "--all", "--budget", "1024");
    assert.equal(r.status, 0);
    assert.equal(r.data.checked, 3);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("rejects workspace escapes and malformed budgets", () => {
  const root = fixture({ "AGENTS.md": "root" });
  try {
    assert.equal(run(root, "--path", "../outside").data.findings[0].type, "outside_workspace");
    const p = spawnSync(process.execPath, [script, "--root", root, "--budget", "-3"], {encoding:"utf8"});
    assert.equal(p.status, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("detects a symlink escaping the workspace", () => {
  const root = fixture({ "AGENTS.md": "root" });
  const outside = mkdtempSync(join(tmpdir(), "alix-dox-outside-"));
  try {
    symlinkSync(outside, join(root, "escape"));
    const r = run(root, "--path", "escape/file.ts");
    assert.equal(r.status, 1);
    assert.equal(r.data.findings[0].type, "symlink_escape");
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});
test("read-only verdict: no claim that Codex actually read documents", () => {
  const root = fixture({ "AGENTS.md": "root" });
  try {
    const r = run(root, "--path", "future.ts");
    assert.equal(r.status, 0);
    assert.match(r.data.note, /does not establish that Codex read/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("fails closed for in-workspace symlink aliases that would hide owning DOX",()=>{
 const root=fixture({"AGENTS.md":"root","src/AGENTS.md":"s".repeat(2000),"src/nested/AGENTS.md":"nested"});
 try {
  symlinkSync("src/nested",join(root,"alias"),"dir");
  const result=run(root,"--budget","1024","--path","alias/future.ts");
  assert.equal(result.status,1);
  assert.equal(result.data.ok,false);
  assert(result.data.findings.some(f=>f.type==="symlink_escape"));
  assert.equal(result.data.checked,0);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test("rejects a dangling symlink ancestor rather than accepting its lexical chain",()=>{
 const root=fixture({"AGENTS.md":"root"});
 try {
  symlinkSync("missing-target",join(root,"dangling"));
  const result=run(root,"--path","dangling/file.ts");
  assert.equal(result.status,1);
  assert(result.data.findings.some(f=>f.type==="symlink_escape"));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test("measures AGENTS.override.md instead of shadowed AGENTS.md",()=>{
 const root=fixture({"AGENTS.md":"root","src/AGENTS.md":"short","src/AGENTS.override.md":"x".repeat(2000)});
 try{
  const r=run(root,"--budget","1024","--path","src/future.ts");
  assert.equal(r.status,1);
  assert.deepEqual(r.data.records[0].chain,["AGENTS.md","src/AGENTS.override.md"]);
  assert(r.data.findings.some(x=>x.type==="budget_overflow"));
 }finally{rmSync(root,{recursive:true,force:true});}
});
test("all mode inspects override-only subtree and chooses its effective instructions",()=>{
 const root=fixture({"AGENTS.md":"root","a/AGENTS.override.md":"x".repeat(1500)});
 try{
  const r=run(root,"--all","--budget","1024");
  assert.equal(r.status,1);
  assert.equal(r.data.checked,2);
  assert(r.data.records.some(x=>x.chain.includes("a/AGENTS.override.md")));
 }finally{rmSync(root,{recursive:true,force:true});}
});
test("parses TOML underscore and base-prefixed integer instruction budgets",()=>{
 const root=fixture({"AGENTS.md":"root","src/AGENTS.md":"x".repeat(1500)});
 try{
  for(const text of ["project_doc_max_bytes = 1_024","project_doc_max_bytes = 0x400"]){
   writeFileSync(join(root,"codex.toml"),text+"\n");
   const r=run(root,"--config",join(root,"codex.toml"),"--path","src/future.ts");
   assert.equal(r.status,1);
   assert.equal(r.data.budget,1024);
   assert(r.data.findings.some(x=>x.type==="budget_overflow"));
  }
 }finally{rmSync(root,{recursive:true,force:true});}
});
test("malformed configured budget does not fall back to a larger default",()=>{
 const root=fixture({"AGENTS.md":"root","codex.toml":"project_doc_max_bytes = 1__024\n"});
 try{
  const p=spawnSync(process.execPath,[script,"--root",root,"--config",join(root,"codex.toml"),"--path","future.ts"],{encoding:"utf8"});
  assert.equal(p.status,2);
 }finally{rmSync(root,{recursive:true,force:true});}
});
