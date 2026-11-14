import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, utimesSync, rmSync } from "node:fs";
import { delimiter as pathDelimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import {
  DOC_EXTENSIONS,
  changedFiles,
  classifyEvidence,
  distReadiness,
  hasHistoryBeyondRoot,
  resolveChangeSet,
  resolveChangeSetOutcome,
  selectAffectedTests,
  runGit,
  runStepProcess,
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

test("an unparseable rev-list answer reaches the report as not_checked, not as an empty PASS", () => {
  // `hasHistoryBeyondRoot` throwing is necessary but not enough: the caller has
  // to turn that throw into a recorded gap. Asserting only the throw would pass
  // even if the catch recorded PASS over an empty set, which is the exact
  // false-green the helper exists to prevent.
  for (const bad of ["", "abc", "1.5", "-3"]) {
    const gitRun = (argv) => {
      if (argv[0] === "rev-list") return bad;
      return "";
    };
    const outcome = resolveChangeSetOutcome(null, gitRun);
    assert.equal(outcome.changed, null, `output ${JSON.stringify(bad)} must not yield a change set`);
    assert.equal(outcome.status, "not_checked", `output ${JSON.stringify(bad)} must be recorded as a gap`);
    assert.match(outcome.detail, /could not read the change set|not a commit count/);
    assert.ok(
      verdictOf([{ name: "changed files", status: outcome.status }]).ok === false,
      "a not_checked change set must leave the run non-green",
    );
  }

  // The same wiring for the base-less refusal with real committed history.
  const refused = resolveChangeSetOutcome(null, (argv) => (argv[0] === "rev-list" ? " 4\n" : ""));
  assert.equal(refused.changed, null);
  assert.equal(refused.status, "not_checked");
  assert.match(refused.detail, /no base ref resolved/);
  assert.equal(verdictOf([{ name: "changed files", status: refused.status }]).ok, false);
});

test("the preflight CLI records an unparseable change set as UNKNOWN and exits 1", () => {
  // The helper test above proves the decision; this proves the caller acts on
  // it, through the real CLI. `rev-list --count HEAD` only runs when no base
  // resolves, so the fixture is a `master`-named repo with no `main` ref.
  const realGit = spawnSync("git", ["--exec-path"], { encoding: "utf8" });
  assert.equal(realGit.status, 0, "the test needs the real git to delegate to");
  const gitBinary = spawnSync(process.platform === "win32" ? "where" : "which", ["git"], { encoding: "utf8" });
  assert.equal(gitBinary.status, 0, "the test needs to locate the real git binary");
  const realGitPath = gitBinary.stdout.split("\n")[0].trim();

  const root = mkdtempSync(join(tmpdir(), "alix-preflight-cli-"));
  try {
    // A real repository, so `rev-parse`/`diff` answer normally and only the
    // commit count is intercepted.
    spawnSync("git", ["init", "-q", "-b", "master"], { cwd: root });
    mkdirSync(join(root, "scripts"), { recursive: true });
    writeFileSync(
      join(root, "scripts", "preflight.mjs"),
      readFileSync(new URL("../../scripts/preflight.mjs", import.meta.url)),
    );

    // `git` that lies only about `rev-list --count HEAD`.
    mkdirSync(join(root, "bin"), { recursive: true });
    const shimPath = join(root, "bin", process.platform === "win32" ? "git.cmd" : "git");
    writeFileSync(
      shimPath,
      process.platform === "win32"
        ? `@echo off\r\nif "%~1 %~2 %~3"=="rev-list --count HEAD" (\r\n  echo abc\r\n  exit /b 0\r\n)\r\n"${realGitPath}" %*\r\n`
        : `#!/bin/sh\nif [ "$1 $2 $3" = "rev-list --count HEAD" ]; then echo abc; exit 0; fi\nexec "${realGitPath}" "$@"\n`,
      { mode: 0o755 },
    );

    const result = spawnSync(process.execPath, [join(root, "scripts", "preflight.mjs")], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: join(root, "bin") + pathDelimiter + (process.env.PATH ?? "") },
    });

    // The load-bearing assertion is the recorded line: it is the caller turning
    // the throw into an UNKNOWN, which is the decision the fix makes. Exit
    // status alone is not evidence here — the fixture carries none of the other
    // checkers, so they fail too and would keep the run red on their own.
    assert.match(result.stdout, /UNKNOWN\s+changed files\s+—\s+could not read the change set/);
    assert.match(result.stdout, /not a commit count/);
    assert.doesNotMatch(result.stdout, /PASS\s+changed files/);
    assert.doesNotMatch(result.stdout, /Preflight OK/);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("every change-set diff sees gitlink records", () => {
  // A .gitmodules `ignore = all` entry is repository-controlled, and it removes
  // every submodule record from git diff output. Without --ignore-submodules=none
  // a push whose only change is a submodule pointer looked documentation-only,
  // so preflight skipped typecheck and tests and still exited 0. The flag has to
  // be on each required diff, not only the committed one: a dirty or staged
  // gitlink is the same content.
  const seen = [];
  const gitRun = (argv) => {
    seen.push(argv);
    return "";
  };
  changedFiles("origin/main", gitRun);
  const diffs = seen.filter((argv) => argv[0] === "diff");
  assert.equal(diffs.length, 3, "committed, working-tree and staged diffs are all required input");
  for (const argv of diffs) {
    assert.ok(
      argv.includes("--ignore-submodules=none"),
      `${argv.join(" ")} must not let a .gitmodules ignore rule hide a gitlink`,
    );
  }
});

test("a submodule-only change is not classified as documentation-only", () => {
  // The consequence, not the flag: if the change set contains a gitlink path,
  // preflight must run the type checks instead of skipping them.
  const gitRun = (argv) => {
    if (argv[0] === "diff" && argv.includes("origin/main...HEAD")) return "vendor/lib\n";
    return "";
  };
  const changed = resolveChangeSet("origin/main", gitRun);
  assert.deepEqual(changed, ["vendor/lib"]);
  for (const file of changed) {
    const dot = file.lastIndexOf(".");
    const ext = dot === -1 ? "" : file.slice(dot).toLowerCase();
    assert.ok(!DOC_EXTENSIONS.has(ext), `${file} must not be treated as documentation-only`);
  }
});

test("a readable change set is recorded as PASS through the same wiring", () => {
  const gitRun = (argv) => {
    if (argv[0] === "rev-list") return " 1\n";
    if (argv[0] === "diff") return "docs/readme.md\n";
    return "";
  };
  const outcome = resolveChangeSetOutcome(null, gitRun);
  assert.deepEqual(outcome.changed, ["docs/readme.md"]);
  assert.equal(outcome.status, "pass");
  assert.equal(verdictOf([{ name: "changed files", status: outcome.status }]).ok, true);
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

test("runStep spawns children with the replacement guard, not the ambient environment", () => {
  // preflight's own git() is guarded, so a child that reads git for itself
  // looked protected and was not: `check:dox` resolves the head tree and
  // `check:evidence` reads history. Measured end-to-end, a replacement ref made
  // `pnpm preflight` report PASS over a claim the branch does not contain.
  //
  // Asserting `stepEnv()` alone never proved the child received it. Nor does
  // `stepSpawnOptions()`: `spawnSync(..., { ...process.env })` inside runStep
  // bypassed the helper with 34/34 still green. So this calls the delegate
  // `runStep` calls and asserts the guard is the RESULT's, independent of what
  // the caller exported.
  const previous = process.env.GIT_NO_REPLACE_OBJECTS;
  try {
    for (const ambient of [undefined, "0"]) {
      if (ambient === undefined) delete process.env.GIT_NO_REPLACE_OBJECTS;
      else process.env.GIT_NO_REPLACE_OBJECTS = ambient;
      const result = runStepProcess(process.execPath, ["-p", "process.env.GIT_NO_REPLACE_OBJECTS"]);
      assert.equal(result.status, 0, String(result.stderr));
      assert.equal(
        String(result.stdout).trim(),
        "1",
        `a child must run guarded even when the caller exported ${JSON.stringify(ambient)}`,
      );
    }
  } finally {
    if (previous === undefined) delete process.env.GIT_NO_REPLACE_OBJECTS;
    else process.env.GIT_NO_REPLACE_OBJECTS = previous;
  }
});

test("preflight's own git reads run with replacement objects disabled and observe the real tree", () => {
  // This is `git()` itself (now `runGit`), not a helper beside it. A git()
  // spawning `{ ...process.env }` left `changedFiles()` reporting a subset of a
  // replaced base with every test green: the branch looked documentation-only,
  // so typecheck and tests were skipped. The fixture is a real repository whose
  // HEAD is replaced by a tree that drops the source change; a guarded read
  // still sees the real file, an unguarded one does not.
  const realGit = spawnSync("git", ["--exec-path"], { encoding: "utf8" });
  assert.equal(realGit.status, 0, "the test needs the real git");
  const root = mkdtempSync(join(tmpdir(), "alix-preflight-replace-"));
  const previous = process.env.GIT_NO_REPLACE_OBJECTS;
  // An EMPTY `GIT_NO_REPLACE_OBJECTS` still ENABLES the guard, so "unguarded"
  // means the key is absent, not set to "". Deleting it is the only way to ask
  // git to honour a replacement ref.
  const unguardedEnv = () => {
    const env = { ...process.env };
    delete env.GIT_NO_REPLACE_OBJECTS;
    return env;
  };
  try {
    const setup = (...args) => {
      const r = spawnSync("git", args, { cwd: root, encoding: "utf8", env: unguardedEnv() });
      if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
      return r.stdout.trim();
    };
    spawnSync("git", ["init", "-q", "-b", "main"], { cwd: root });
    // A fresh runner has no ambient git identity, so `git commit` there fails
    // with "Author identity unknown" (empty ident name). Set it in the fixture
    // repository; relying on the developer's global config makes the test pass
    // locally and fail in CI.
    setup("config", "user.name", "Preflight Test");
    setup("config", "user.email", "preflight@example.invalid");
    writeFileSync(join(root, "README.md"), "base\n");
    setup("add", "-A");
    setup("commit", "-q", "-m", "base");
    const base = setup("rev-parse", "HEAD");
    writeFileSync(join(root, "README.md"), "changed\n");
    setup("add", "-A");
    setup("commit", "-q", "-m", "real change");
    const head = setup("rev-parse", "HEAD");

    // Synthetic commit: the base tree, i.e. a substitution that hides the change.
    const baseTree = setup("rev-parse", `${base}^{tree}`);
    const synthetic = setup("commit-tree", baseTree, "-p", base, "-m", "replaced head");
    setup("replace", head, synthetic);

    // Premise: the substitution is live for an unguarded read.
    const replaced = spawnSync("git", ["replace", "-l"], { cwd: root, encoding: "utf8", env: unguardedEnv() });
    assert.match(replaced.stdout, new RegExp(head), "fixture premise: the replacement ref exists");
    const unguarded = spawnSync("git", ["diff", "--name-only", `${base}...${head}`], {
      cwd: root,
      encoding: "utf8",
      env: unguardedEnv(),
    });
    assert.equal(unguarded.stdout.trim(), "", "fixture premise: the replacement hides the change");
    // The adversarial ambient state is the variable being ABSENT: git honours a
    // replacement whenever the key is missing. Any value -- including "0" and
    // the empty string -- disables replacements (measured), so exporting one
    // would make the guarded and unguarded reads agree and pin nothing.
    delete process.env.GIT_NO_REPLACE_OBJECTS;
    // `runGit` runs in preflight's own root, so this repo is addressed with
    // `git -C` rather than an override that could also drop the guard.
    assert.equal(
      runGit(["-C", root, "diff", "--name-only", "--ignore-submodules=none", `${base}...${head}`]),
      "README.md",
      "git() must measure real history even when the caller left the guard unset",
    );
  } finally {
    if (previous === undefined) delete process.env.GIT_NO_REPLACE_OBJECTS;
    else process.env.GIT_NO_REPLACE_OBJECTS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
