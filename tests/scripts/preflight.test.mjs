import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DOC_EXTENSIONS, classifyEvidence, distReadiness, selectAffectedTests, tailLines, verdictOf } from "../../scripts/preflight.mjs";

const fixture = (name, specifiers = []) => ({
  file: `/repo/tests/${name}`,
  repoPath: `tests/${name}`,
  specifiers: new Set(specifiers),
});

test("documentation extensions are the ones the verification contract allows", () => {
  for (const ext of [".md", ".markdown", ".txt", ".adoc", ".rst", ".log"]) {
    assert.ok(DOC_EXTENSIONS.has(ext), `${ext} should be doc-only`);
  }
  for (const ext of [".ts", ".json", ".yml", ".sh", ""]) {
    assert.ok(!DOC_EXTENSIONS.has(ext), `${ext} must not be treated as doc-only`);
  }
});

test("a test at the mirrored path is selected", () => {
  const tests = [fixture("security/lock.test.ts"), fixture("agents/other.test.ts")];
  const { selected } = selectAffectedTests(["src/governance/security/lock.ts"], tests);
  assert.deepEqual(selected, ["tests/security/lock.test.ts"]);
});

test("a test sharing a basename with the changed source is selected", () => {
  const tests = [fixture("somewhere-else/lock.test.ts")];
  const { selected } = selectAffectedTests(["src/governance/security/lock.ts"], tests);
  assert.deepEqual(selected, ["tests/somewhere-else/lock.test.ts"]);
});

test("a test that imports the changed module is selected", () => {
  const tests = [fixture("security/via-import.test.ts", ["../../../src/governance/security/lock.js"])];
  const { selected } = selectAffectedTests(["src/governance/security/lock.ts"], tests);
  assert.deepEqual(selected, ["tests/security/via-import.test.ts"]);
});

test("an untested source file is reported as unmapped rather than as safe", () => {
  const { selected, unmapped } = selectAffectedTests(["src/governance/security/orphan.ts"], [fixture("x/other.test.ts")]);
  assert.deepEqual(selected, []);
  assert.deepEqual(unmapped, ["src/governance/security/orphan.ts"]);
});

test("changed test files are always selected", () => {
  const tests = [fixture("security/lock.test.ts"), fixture("security/untouched.test.ts")];
  const { selected } = selectAffectedTests(["tests/security/lock.test.ts"], tests);
  assert.deepEqual(selected, ["tests/security/lock.test.ts"]);
});

test("vitest files are selected too", () => {
  const tests = [fixture("security/lock.vitest.ts")];
  const { selected } = selectAffectedTests(["src/governance/security/lock.ts"], tests);
  assert.deepEqual(selected, ["tests/security/lock.vitest.ts"]);
});

test("non-src changes select nothing and are not invented", () => {
  const { selected, unmapped } = selectAffectedTests(["docs/x.md"], [fixture("a/b.test.ts")]);
  assert.deepEqual(selected, []);
  assert.deepEqual(unmapped, []);
});

test("distReadiness names a missing compiled test instead of running it", () => {
  const root = mkdtempSync(join(tmpdir(), "pf-"));
  try {
    mkdirSync(join(root, "tests/security"), { recursive: true });
    writeFileSync(join(root, "tests/security/lock.test.ts"), "test");
    const result = distReadiness(["tests/security/lock.test.ts"], [], root);
    assert.deepEqual(result.missing, ["tests/security/lock.test.ts"]);
    assert.deepEqual(result.stale, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("distReadiness reports a stale build, not a pass", () => {
  const root = mkdtempSync(join(tmpdir(), "pf-"));
  try {
    mkdirSync(join(root, "tests/security"), { recursive: true });
    mkdirSync(join(root, "dist/tests/security"), { recursive: true });
    mkdirSync(join(root, "src/governance/security"), { recursive: true });
    mkdirSync(join(root, "dist/src/governance/security"), { recursive: true });
    writeFileSync(join(root, "tests/security/lock.test.ts"), "test");
    writeFileSync(join(root, "dist/tests/security/lock.test.js"), "compiled");
    writeFileSync(join(root, "src/governance/security/lock.ts"), "source");
    writeFileSync(join(root, "dist/src/governance/security/lock.js"), "compiled");
    utimesSync(join(root, "tests/security/lock.test.ts"), new Date(2000, 0, 1), new Date(2000, 0, 1));
    utimesSync(join(root, "dist/tests/security/lock.test.js"), new Date(2020, 0, 1), new Date(2020, 0, 1));
    utimesSync(join(root, "dist/src/governance/security/lock.js"), new Date(2000, 0, 1), new Date(2000, 0, 1));
    utimesSync(join(root, "src/governance/security/lock.ts"), new Date(2020, 0, 1), new Date(2020, 0, 1));

    const result = distReadiness(["tests/security/lock.test.ts"], ["src/governance/security/lock.ts"], root);
    assert.deepEqual(result.missing, []);
    assert.ok(result.stale.includes("src/governance/security/lock.ts"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a fresh build is runnable", () => {
  const root = mkdtempSync(join(tmpdir(), "pf-"));
  try {
    mkdirSync(join(root, "tests/security"), { recursive: true });
    mkdirSync(join(root, "dist/tests/security"), { recursive: true });
    writeFileSync(join(root, "tests/security/lock.test.ts"), "test");
    writeFileSync(join(root, "dist/tests/security/lock.test.js"), "compiled");
    utimesSync(join(root, "tests/security/lock.test.ts"), new Date(2000, 0, 1), new Date(2000, 0, 1));
    utimesSync(join(root, "dist/tests/security/lock.test.js"), new Date(2020, 0, 1), new Date(2020, 0, 1));
    const result = distReadiness(["tests/security/lock.test.ts"], [], root);
    assert.deepEqual(result, { missing: [], stale: [] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("not_checked is not a pass and fails the run closed", () => {
  const verdict = verdictOf([
    { name: "typecheck", status: "pass" },
    { name: "affected tests", status: "not_checked", detail: "dist is stale" },
  ]);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.notChecked.length, 1);
  assert.equal(verdict.failures.length, 0);
});

test("an intentional skip is not an unknown and can still pass", () => {
  const verdict = verdictOf([
    { name: "typecheck", status: "skipped" },
    { name: "affected tests", status: "skipped" },
    { name: "check:dox", status: "pass" },
  ]);
  assert.equal(verdict.ok, true);
});

test("any failing check fails the run", () => {
  const verdict = verdictOf([
    { name: "typecheck", status: "fail" },
    { name: "check:dox", status: "pass" },
  ]);
  assert.equal(verdict.ok, false);
  assert.deepEqual(
    verdict.failures.map((s) => s.name),
    ["typecheck"],
  );
});

test("failure output keeps the tail, where the error is", () => {
  const output = Array.from({ length: 40 }, (_, i) => `line-${i + 1}`).join("\n");
  const lines = tailLines(output, 12);
  assert.equal(lines.length, 12);
  assert.equal(lines[0], "line-29");
  assert.equal(lines.at(-1), "line-40");
  assert.deepEqual(tailLines("", 4), [""]);
});

test("the evidence checker's not_checked exit 0 becomes UNKNOWN, not PASS", () => {
  const stdout = JSON.stringify({ verdict: "not_checked", notChecked: ["artifact is uncommitted"] });
  assert.deepEqual(classifyEvidence(stdout, 0), { status: "not_checked", detail: "artifact is uncommitted" });
});

test("the evidence checker's pass and pass_with_accepted verdicts pass", () => {
  assert.equal(classifyEvidence(JSON.stringify({ verdict: "pass" }), 0).status, "pass");
  assert.equal(classifyEvidence(JSON.stringify({ verdict: "pass_with_accepted" }), 0).status, "pass");
});

test("the evidence checker's fail verdict stays a failure even if the exit code is ignored", () => {
  assert.equal(classifyEvidence(JSON.stringify({ verdict: "fail" }), 1).status, "fail");
  assert.equal(classifyEvidence(JSON.stringify({ verdict: "error", error: "bad manifest" }), 2).status, "fail");
});

test("unstructured evidence-checker output falls back to the exit code", () => {
  assert.equal(classifyEvidence("not json", 0).status, "pass");
  assert.equal(classifyEvidence("not json", 1).status, "fail");
});
