import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DOC_EXTENSIONS,
  changedFiles,
  classifyEvidence,
  distReadiness,
  hasHistoryBeyondRoot,
  resolveChangeSet,
  selectAffectedTests,
  tailLines,
  verdictOf,
} from "../../scripts/preflight.mjs";

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

test("a git failure while computing the change set is not swallowed", () => {
  // The defect this pins: `tryGit` returned null on a failed diff, so the
  // change set could shrink to nothing and a docs-only shortcut or an empty
  // affected-test selection would read as clean. A required read that fails is
  // an error, not an empty result.
  assert.throws(
    () =>
      changedFiles("origin/main", () => {
        throw new Error("git diff failed");
      }),
    /git diff failed/,
  );
});

test("a base-less run over committed history refuses to call its fragment the change set", () => {
  // Without --base, preflight falls back to `origin/main` or `main`. In a
  // repository that has neither, it used to inspect only uncommitted files and
  // still record `changed files` as PASS — so a branch with committed work and
  // a docs-only working tree could exit 0 having typechecked nothing.
  const history = (count) => () => String(count);
  assert.equal(hasHistoryBeyondRoot(history(1)), false, "a root-only repository has no committed branch work");
  assert.equal(hasHistoryBeyondRoot(history(2)), true, "any ancestor means committed work exists");
  assert.equal(hasHistoryBeyondRoot(history(37)), true);
  // git's output is whitespace-padded; the count is parsed, not compared.
  assert.equal(hasHistoryBeyondRoot(history(" 3\n")), true);
  // A root-only repository reports 1, which must not be read as "has history".
  assert.equal(hasHistoryBeyondRoot(history(" 1\n")), false);
  // Unparseable output must not read as a root-only repository. `Number("")` is
  // 0 and `Number("abc")` is NaN, and both compare false against 1: guessing
  // there would silently restore the uncommitted-only fallback this fixes.
  for (const bad of ["", "   ", "abc", "1.5", "-3"]) {
    assert.throws(() => hasHistoryBeyondRoot(history(bad)), /not a commit count/, `output ${JSON.stringify(bad)}`);
  }
});

test("the resolved change set exceeds uncommitted files exactly when git can see committed work", () => {
  // This is the wiring, not the helper: a bare `hasHistoryBeyondRoot` test
  // proves the predicate and says nothing about whether a base-less run acts on
  // it. Here one stub answers both the ancestry probe and the diffs, so a
  // regression that skips the refusal shows up as a non-null fragment.
  const stub = (count) => (argv) => {
    if (argv[0] === "rev-list") return ` ${count}\n`;
    if (argv[0] === "diff") return "src/uncommitted.ts\n";
    return "";
  };

  assert.deepEqual(resolveChangeSet(null, stub(1)), ["src/uncommitted.ts"], "a truly root-only repo may use its uncommitted files");
  assert.equal(resolveChangeSet(null, stub(2)), null, "committed branch work must refuse, not shrink to a fragment");

  // A resolved base stays a normal diff and never consults ancestry.
  const withBase = (argv) => {
    assert.notEqual(argv[0], "rev-list", "a resolved base must not need the ancestry probe");
    if (argv[0] === "diff") return argv.includes("origin/main...HEAD") ? "src/committed.ts\n" : "";
    return "";
  };
  assert.deepEqual(resolveChangeSet("origin/main", withBase), ["src/committed.ts"]);
});

test("changed files are the union of committed, working, staged, and untracked", () => {
  const calls = [];
  const fakeGit = (argv) => {
    calls.push(argv.join(" "));
    if (argv[0] === "ls-files") return "new-file.ts\n";
    if (argv.includes("--cached")) return "staged.ts\n";
    if (argv.includes("HEAD")) return "working.ts\n";
    // `staged.ts` also appears here: the union must de-duplicate.
    return "committed.ts\nstaged.ts\n";
  };
  assert.deepEqual(changedFiles("origin/main", fakeGit), ["committed.ts", "new-file.ts", "staged.ts", "working.ts"]);
  assert.equal(calls.length, 4);
});

test("the evidence checker's not_checked exit 0 becomes UNKNOWN, not PASS", () => {
  const stdout = JSON.stringify({ verdict: "not_checked", notChecked: ["artifact is uncommitted"] });
  assert.deepEqual(classifyEvidence(stdout, 0), { status: "not_checked", detail: "artifact is uncommitted" });
});

test("the evidence checker's pass and pass_with_accepted verdicts pass", () => {
  assert.equal(classifyEvidence(JSON.stringify({ verdict: "pass" }), 0).status, "pass");
  assert.equal(classifyEvidence(JSON.stringify({ verdict: "pass_with_accepted" }), 0).status, "pass");
});

test("a bounded declared-skip acknowledgement is a pass that names itself", () => {
  // `--allow-declared-skips` exists so CI can acknowledge a pinned set of
  // non-reproducible generators. It is still a pass, but the detail keeps the
  // acknowledgement visible instead of collapsing into a bare "pass".
  const stdout = JSON.stringify({ verdict: "pass_with_declared_skips", notChecked: ["recompute NOT CHECKED for 4"] });
  assert.deepEqual(classifyEvidence(stdout, 0), { status: "pass", detail: "pass_with_declared_skips" });
});

test("the evidence checker's fail verdict stays a failure even if the exit code is ignored", () => {
  assert.equal(classifyEvidence(JSON.stringify({ verdict: "fail" }), 1).status, "fail");
  assert.equal(classifyEvidence(JSON.stringify({ verdict: "error", error: "bad manifest" }), 2).status, "fail");
});

test("unstructured evidence-checker output is unknown, never a pass", () => {
  // The checker is invoked with --json. Output that cannot be read as a verdict
  // means the verdict is unknown; inferring PASS from exit 0 is precisely the
  // "silence read as coverage" failure this whole script exists to prevent.
  const zero = classifyEvidence("not json", 0);
  assert.equal(zero.status, "not_checked");
  assert.match(zero.detail, /no JSON verdict/);
  assert.equal(classifyEvidence("not json", 1).status, "fail");
  assert.equal(classifyEvidence("", 0).status, "not_checked");
});

test("structured JSON without a verdict is a failure, not an implicit pass", () => {
  assert.equal(classifyEvidence(JSON.stringify({ ok: true }), 0).status, "fail");
  assert.equal(classifyEvidence(JSON.stringify(null), 0).status, "fail");
  assert.equal(classifyEvidence(JSON.stringify({ verdict: "greenish" }), 0).status, "fail");
});

test("same-named tests in different directories are never dropped", () => {
  // Over-selection is the safe direction here (the heuristic already admits it
  // selects candidates, not proofs). The defect to prevent is the opposite: a
  // single-value map keyed by path let one entry replace another, so a test
  // silently vanished from the candidate set.
  const tests = [fixture("a/x.test.ts"), fixture("b/x.test.ts")];
  for (const source of ["src/a/x.ts", "src/b/x.ts"]) {
    const { selected, unmapped } = selectAffectedTests([source], tests);
    assert.deepEqual(unmapped, []);
    assert.ok(selected.includes(`tests/${source.replace(/^src\//, "").replace(/\.ts$/, ".test.ts")}`), `${source} keeps its own test`);
  }
});

test("the mirrored-path lookup keeps every test registered at one key", () => {
  // Both fixtures strip to `security/lock`; neither may be dropped from the map.
  const tests = [fixture("security/lock.test.ts"), fixture("security/lock.vitest.ts")];
  const { selected } = selectAffectedTests(["src/security/lock.ts"], tests);
  assert.deepEqual(selected, ["tests/security/lock.test.ts", "tests/security/lock.vitest.ts"]);
});
