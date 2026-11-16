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
