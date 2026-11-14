// tests/scripts/check-dox-claims.test.mjs
//
// Pins the identifier resolver's reach, not just its verdict.
//
// The resolver grepped `git grep ... -- 'src/**/*.ts' 'scripts/**/*.mjs'`.
// Without `:(glob)` magic, git's leading `**` segment requires at least one
// directory, so `scripts/**/*.mjs` matched no top-level script at all (it
// found 6 of 33 files) and `src/**/*.ts` skipped the four top-level `src/*.ts`
// modules (1522 of 1526). Every identifier defined in those files was
// unreachable, so a correct contract bullet naming one was reported
// "no code" forever. A gate that reports a false failure is as damaging as
// one that passes a false claim: it teaches authors to edit the doc.
//
// These cases run the real script against a throwaway git repository, so they
// assert the end-to-end verdict and would fail if the pathspec regressed.
//
// Run: node --test tests/scripts/check-dox-claims.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const SCRIPT = join(import.meta.dirname, "..", "..", "scripts", "check-dox-claims.mjs");

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "dox-test",
  GIT_AUTHOR_EMAIL: "dox-test@example.invalid",
  GIT_COMMITTER_NAME: "dox-test",
  GIT_COMMITTER_EMAIL: "dox-test@example.invalid",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};
// The key is DELETED from the shared env, not just from the observation
// helpers: every checker invocation in this file must be indifferent to what
// the runner exported. `pnpm preflight` spawns its children with
// `GIT_NO_REPLACE_OBJECTS=1` (`stepEnv()`), and `GIT_ENV` spreading
// `process.env` inherited it -- so under the one runner that executed this
// suite, the replacement-ref test was vacuous: with the checker's guard gutted
// it still passed. An empty string is not a substitute; it also ENABLES the
// guard.
delete GIT_ENV.GIT_NO_REPLACE_OBJECTS;

/**
 * Env for fixtures that must OBSERVE a replacement ref take effect.
 *
 * `GIT_NO_REPLACE_OBJECTS` is DELETED, not blanked: git treats an empty value as
 * enabled, so `{ GIT_NO_REPLACE_OBJECTS: "" }` silently keeps the guard on
 * (measured: `git log -1 <replaced-sha>` still returns the original). The key
 * must be absent. This matters because a parent can export the guard into every
 * child -- preflight does exactly that through `stepEnv()` -- and a fixture that
 * cannot see its own substitution asserts nothing.
 */
const unguardedEnv = (extra = {}) => {
  const env = { ...GIT_ENV, ...extra };
  delete env.GIT_NO_REPLACE_OBJECTS;
  return env;
};

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function write(cwd, relPath, contents) {
  const full = join(cwd, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents);
}

/**
 * Build a repo whose base commit is empty-ish and whose head commit adds one
 * contract bullet naming `symbol`, then report the checker's exit status.
 *
 * `symbol` is defined in `sourcePath`, which the caller chooses by depth:
 * the bug was depth-specific, so the fixture must be able to place it at a
 * top-level path rather than nested.
 */
function auditClaimAbout({ symbol, sourcePath, defined }) {
  const dir = mkdtempSync(join(tmpdir(), "alix-dox-"));
  try {
    git(dir, "init", "--quiet", "--initial-branch=main");
    write(dir, "README.md", "# fixture\n");
    git(dir, "add", "-A");
    git(dir, "commit", "--quiet", "-m", "base");
    const base = git(dir, "rev-parse", "HEAD");

    write(dir, sourcePath, defined ? `export const ${symbol} = 1;\n` : "export const other = 1;\n");
    write(dir, "AGENTS.md", `# Fixture\n\n- The contract names \`${symbol}\`.\n`);
    git(dir, "add", "-A");
    git(dir, "commit", "--quiet", "-m", "head");
    const head = git(dir, "rev-parse", "HEAD");

    const r = spawnSync(process.execPath, [SCRIPT, "--base", base, "--head", head], {
      cwd: dir,
      encoding: "utf8",
    });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("resolves an identifier defined in a top-level script", () => {
  const r = auditClaimAbout({
    symbol: "parseScopeDeclaration",
    sourcePath: "scripts/check-pr-scope.mjs",
    defined: true,
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /resolve to the branch's own content/);
});

test("resolves an identifier defined in a top-level src module", () => {
  const r = auditClaimAbout({
    symbol: "classifyTask",
    sourcePath: "src/task-classifier.ts",
    defined: true,
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("still rejects an identifier that no source file defines", () => {
  const r = auditClaimAbout({
    symbol: "noSuchSymbolAnywhere",
    sourcePath: "scripts/check-pr-scope.mjs",
    defined: false,
  });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /no code/);
});



test("a .gitmodules ignore rule cannot make the audit vacuous", () => {
  // `.gitmodules` `ignore = all` is repository-controlled and drops gitlink
  // records from every diff. If the ONLY change a branch makes is a gitlink
  // bump, a plain diff reports nothing at all, base !== head, and the audit has
  // no change to scan. That must land on the explicit "changed nothing" refusal
  // rather than a CLEAN verdict that merely never looked -- the same false green
  // as verifying a tree nobody committed.
  //
  // The ignore file is committed in the BASE so it is not itself the change
  // being judged, and a real file changes alongside the gitlink so the fixture
  // cannot pass by being empty for an unrelated reason.
  const dir = mkdtempSync(join(tmpdir(), "alix-dox-submodule-"));
  const run = (...args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8", env: GIT_ENV });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  try {
    run("init", "--quiet", "--initial-branch=main");
    write(dir, "README.md", "# fixture\n");
    write(dir, "src/thing.ts", "export const other = 1;\n");
    write(
      dir,
      ".gitmodules",
      '[submodule "contracts"]\n\tpath = contracts\n\turl = https://example.invalid/contracts.git\n\tignore = all\n',
    );
    run("add", "-A");
    run("commit", "--quiet", "-m", "base");
    const base = run("rev-parse", "HEAD");
    // Plant the gitlink in the base, so the branch's change to it is a BUMP.
    run("update-index", "--add", "--cacheinfo", `160000,${base},contracts`);
    run("commit", "--quiet", "-m", "base with gitlink");
    const baseWithLink = run("rev-parse", "HEAD");

    // Head: a real file changes AND the gitlink moves. Only the real file is
    // visible to a plain diff.
    write(dir, "src/thing.ts", "export const changed = 2;\n");
    run("add", "src/thing.ts");
    run("update-index", "--add", "--cacheinfo", `160000,${run("commit-tree", run("rev-parse", "HEAD^{tree}"), "-m", "bump")},contracts`);
    run("commit", "--quiet", "-m", "head");
    const head = run("rev-parse", "HEAD");

    // Fixture validity: the ignore rule really hides the gitlink from a plain
    // diff, and the flag really reveals it. A red result without this proves
    // nothing.
    const plain = spawnSync("git", ["diff", "--name-only", `${baseWithLink}...${head}`], {
      cwd: dir,
      encoding: "utf8",
      env: GIT_ENV,
    });
    const revealed = spawnSync(
      "git",
      ["diff", "--name-only", "--ignore-submodules=none", `${baseWithLink}...${head}`],
      { cwd: dir, encoding: "utf8", env: GIT_ENV },
    );
    assert.equal(plain.status, 0, plain.stderr);
    assert.doesNotMatch(plain.stdout, /contracts/, "fixture must hide the gitlink without the flag");
    assert.match(revealed.stdout, /contracts/, "fixture must reveal the gitlink with the flag");
    assert.match(revealed.stdout, /src\/thing\.ts/, "the ordinary change must still be visible");

    const check = () => {
      const r = spawnSync(process.execPath, [SCRIPT, "--json", "--base", baseWithLink, "--head", head], {
        cwd: dir,
        encoding: "utf8",
        env: GIT_ENV,
      });
      return { status: r.status, report: JSON.parse(r.stdout) };
    };

    // With the guard: the gitlink is part of the change set, so the run reports a
    // real (non-vacuous) verdict instead of "refs differ but nothing changed".
    // The change-set SIZE is the observable: the gitlink must be counted
    // alongside the ordinary file. Without the flag it is 1, not 2 -- which is
    // exactly the size the audit would have reported while a contract inside the
    // submodule changed unread.
    const guarded = check();
    assert.equal(guarded.status, 0, JSON.stringify(guarded.report));
    assert.equal(guarded.report.vacuous, false, "the gitlink must be part of the change set");
    assert.match(guarded.report.exitWhy, /^2 file\(s\) changed, none a contract$/, guarded.report.exitWhy);

    // Without the flag the very same history is invisible, and the audit falls
    // into the vacuous refusal. Removing the flag from the checker must produce
    // exactly this, which is what makes this test a pin rather than a formality.
    const unguardedDiff = spawnSync(
      "git",
      ["diff", "--name-only", `${baseWithLink}...${head}`],
      { cwd: dir, encoding: "utf8", env: GIT_ENV },
    );
    const visibleOnlyWithFlag = unguardedDiff.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    assert.deepEqual(
      visibleOnlyWithFlag,
      ["src/thing.ts"],
      "without the flag the gitlink is the ONLY thing that disappears from the change set",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a gitlink-only branch is counted, not read as an unchanged range", () => {
  // The companion test above keeps an ordinary file changed alongside the
  // gitlink, so its verdict is green whether or not the flag is present: one
  // visible file is still a non-empty change set. That made it a pin on the
  // fixture, not on the checker.
  //
  // The flag's real effect shows on a branch whose ONLY change is a gitlink
  // bump -- the normal shape of a dependency checkout moving. Guarded, that is
  // "1 file(s) changed, none a contract" (a complete answer: it edits no
  // contract). Unguarded, the change set is EMPTY while base !== head, and the
  // audit lands on the VACUOUS refusal. Both are non-green-or-green in the wrong
  // direction, so the assertion is the exact change-set size the checker reports.
  const dir = mkdtempSync(join(tmpdir(), "alix-dox-gitlink-only-"));
  const run = (...args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8", env: GIT_ENV });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  try {
    run("init", "--quiet", "--initial-branch=main");
    write(dir, "README.md", "# fixture\n");
    write(
      dir,
      ".gitmodules",
      '[submodule "contracts"]\n\tpath = contracts\n\turl = https://example.invalid/contracts.git\n\tignore = all\n',
    );
    run("add", "-A");
    run("commit", "--quiet", "-m", "base");
    const base = run("rev-parse", "HEAD");
    run("update-index", "--add", "--cacheinfo", `160000,${base},contracts`);
    run("commit", "--quiet", "-m", "base with gitlink");
    const baseWithLink = run("rev-parse", "HEAD");

    // Head: NOTHING but the gitlink moves.
    const bump = run("commit-tree", run("rev-parse", "HEAD^{tree}"), "-m", "bump");
    run("update-index", "--add", "--cacheinfo", `160000,${bump},contracts`);
    run("commit", "--quiet", "-m", "head");
    const head = run("rev-parse", "HEAD");

    // Fixture validity: without the flag the range really is empty, and with it
    // the range really is one file. A red result without both proves nothing.
    const plain = spawnSync("git", ["diff", "--name-only", `${baseWithLink}...${head}`], {
      cwd: dir,
      encoding: "utf8",
      env: GIT_ENV,
    });
    assert.equal(plain.stdout.trim(), "", "fixture must hide the ONLY change without the flag");

    const result = spawnSync(
      process.execPath,
      [SCRIPT, "--json", "--base", baseWithLink, "--head", head],
      { cwd: dir, encoding: "utf8", env: GIT_ENV },
    );
    const report = JSON.parse(result.stdout);
    assert.equal(result.status, 0, JSON.stringify(report));
    assert.equal(report.vacuous, false, "a gitlink bump must count as a change");
    assert.equal(report.exitWhy, "1 file(s) changed, none a contract", report.exitWhy);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a replacement ref cannot hide an added contract claim", () => {
  // The DOX audit's scope is "lines the branch ADDS relative to base". A
  // replacement ref rewrites the base's tree, so the range diff can drop the
  // AGENTS.md hunk while another file still differs -- `anyChangedFiles` is then
  // non-empty and the run reports CLEAN for a claim it never read. That is a
  // false pass, so the diff must not be substitutable.
  const dir = mkdtempSync(join(tmpdir(), "alix-dox-replace-"));
  // This fixture CREATES a replacement ref and must then observe its effect,
  // so the guard is removed from the environment rather than relied on. A
  // parent that exports `GIT_NO_REPLACE_OBJECTS=1` into every child (preflight
  // does, via `stepEnv()`) would otherwise make the substitution invisible and
  // the "fixture must hide" assertion below would fail for the wrong reason.
  // Only an ABSENT key honours replacements: empty, "0", and "1" all ENABLE
  // the guard, so `unguardedEnv()` deletes the key rather than blanking it.
  const env = unguardedEnv();
  const run = (...args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8", env });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  try {
    run("init", "--quiet", "--initial-branch=main");
    write(dir, "README.md", "# fixture\n");
    write(dir, "src/thing.ts", "export const other = 1;\n");
    run("add", "-A");
    run("commit", "--quiet", "-m", "base");
    const base = run("rev-parse", "HEAD");

    write(dir, "AGENTS.md", "# Fixture\n\n- The contract names `bogusSymbolNotInCode`.\n");
    write(dir, "src/thing.ts", "export const changed = 2;\n");
    run("add", "-A");
    run("commit", "--quiet", "-m", "head");
    const head = run("rev-parse", "HEAD");

    // Synthetic base = base tree + the AGENTS.md claim, so the substituted range
    // diff carries only the src change and the claim is invisible to the scan.
    const indexFile = join(dir, ".git", "synthetic-index");
    const idxEnv = { ...env, GIT_INDEX_FILE: indexFile };
    const idx = (...args) => {
      const r = spawnSync("git", args, { cwd: dir, encoding: "utf8", env: idxEnv });
      if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
      return r.stdout.trim();
    };
    idx("read-tree", base);
    const agentsBlob = run("rev-parse", `${head}:AGENTS.md`);
    idx("update-index", "--add", "--cacheinfo", `100644,${agentsBlob},AGENTS.md`);
    const synthetic = run("commit-tree", idx("write-tree"), "-m", "rewritten base");

    const honest = spawnSync("git", ["diff", "--name-only", `${base}...${head}`], { cwd: dir, encoding: "utf8", env });
    assert.match(honest.stdout, /AGENTS\.md/);

    run("replace", base, synthetic);
    const replaced = spawnSync("git", ["diff", "--name-only", `${base}...${head}`], { cwd: dir, encoding: "utf8", env });
    assert.doesNotMatch(replaced.stdout, /AGENTS\.md/, "fixture must hide the contract change");
    assert.match(replaced.stdout, /src\/thing\.ts/, "fixture must still show a change, else the verdict is VACUOUS, not green");

    const result = spawnSync(process.execPath, [SCRIPT, "--base", base, "--head", head], {
      cwd: dir,
      encoding: "utf8",
      env,
    });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /no code/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a replacement ref cannot hide a missing head-tree file behind a claim", () => {
  // The audit resolves tokens against the HEAD tree (`git cat-file -e
  // <head>:<path>`). Unguarded, a replacement ref makes that tree contain a
  // file the branch does not have, so a contract naming `src/missing.ts`
  // reported "resolve". Only the `sh()` diff path carried the guard; the head
  // read did not.
  const dir = mkdtempSync(join(tmpdir(), "alix-dox-head-replace-"));
  try {
    git(dir, "init", "--quiet", "--initial-branch=main");
    write(dir, "README.md", "# fixture\n");
    git(dir, "add", "-A");
    git(dir, "commit", "--quiet", "-m", "base");
    const base = git(dir, "rev-parse", "HEAD");

    // The branch adds a contract naming a file it does not contain.
    write(dir, "AGENTS.md", "# Fixture\n\n- The contract names `src/missing.ts`.\n");
    write(dir, "src/thing.ts", "export const other = 1;\n");
    git(dir, "add", "-A");
    git(dir, "commit", "--quiet", "-m", "head");
    const head = git(dir, "rev-parse", "HEAD");

    // Synthetic head = the head tree plus src/missing.ts.
    const indexFile = join(dir, ".git", "synthetic-index");
    // Unguarded on purpose: this fixture must see the replacement take effect
    // (see the note on `env` above). `stepEnv()` in preflight exports the guard
    // to every child, so it is dropped here explicitly.
    const observeEnv = unguardedEnv();
    const idxEnv = { ...observeEnv, GIT_INDEX_FILE: indexFile };
    const idx = (...args) => {
      const r = spawnSync("git", args, { cwd: dir, encoding: "utf8", env: idxEnv });
      if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
      return r.stdout.trim();
    };
    const emptyBlob = git(dir, "hash-object", "-w", "--stdin", "--path", "src/missing.ts");
    idx("read-tree", head);
    idx("update-index", "--add", "--cacheinfo", `100644,${emptyBlob},src/missing.ts`);
    const synthetic = git(dir, "commit-tree", idx("write-tree"), "-p", head, "-m", "rewritten head");

    // Fixture validity: unguarded cat-file sees the file, and does not without.
    const unguarded = spawnSync("git", ["cat-file", "-e", `${head}:src/missing.ts`], {
      cwd: dir,
      encoding: "utf8",
      env: observeEnv,
    });
    assert.equal(unguarded.status, 128, "fixture must not contain src/missing.ts at the real head");

    git(dir, "replace", head, synthetic);
    const substituted = spawnSync("git", ["cat-file", "-e", `${head}:src/missing.ts`], {
      cwd: dir,
      encoding: "utf8",
      env: observeEnv,
    });
    assert.equal(substituted.status, 0, "fixture must add the file through the replacement ref");

    const result = spawnSync(process.execPath, [SCRIPT, "--base", base, "--head", head], {
      cwd: dir,
      encoding: "utf8",
      env: GIT_ENV,
    });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /missing file/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
