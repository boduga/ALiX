// tests/scripts/pre-push.test.mjs
//
// Pins the base commit `.githooks/pre-push` chooses. The hook's job is to run
// preflight over the commits the push would add; picking the wrong base means
// the gate either skips the first push of a branch (the one with no review
// behind it) or silently checks nothing at all.
//
// The hook is exercised as a shell program against a throwaway repository with a
// fake `pnpm` earlier on PATH, so the assertion is on the arguments preflight
// actually receives — not on how the script computes them.
import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Walk up from the source or compiled test directory to the hook. */
function findHook(start) {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, ".githooks", "pre-push");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`could not locate .githooks/pre-push from ${start}`);
}

const HOOK = findHook(__dirname);

function git(dir, args) {
  const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

/**
 * A repository whose `main` has one commit, plus a feature branch one commit
 * ahead. A fake `pnpm` records its arguments into `pnpm-args.txt` and exits with
 * `pnpmStatus`.
 */
function fixture(pnpmStatus = 0) {
  const dir = mkdtempSync(join(tmpdir(), "alix-pre-push-"));
  const binDir = join(dir, ".fake-bin");
  mkdirSync(binDir);
  writeFileSync(
    join(binDir, "pnpm"),
    `#!/bin/sh\necho "$@" > "${join(dir, "pnpm-args.txt")}"\nexit ${pnpmStatus}\n`,
  );
  chmodSync(join(binDir, "pnpm"), 0o755);

  git(dir, ["init", "-q", "--initial-branch=main"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Hook Test"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  writeFileSync(join(dir, "README.md"), "base\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "base"]);
  git(dir, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  git(dir, ["switch", "-q", "-c", "feature"]);
  writeFileSync(join(dir, "feature.txt"), "work\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "work"]);
  return { dir, binDir };
}

function runHook(dir, binDir, stdin, env = {}) {
  const result = spawnSync("sh", [HOOK], {
    cwd: dir,
    input: stdin,
    encoding: "utf8",
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, ...env },
  });
  const argsPath = join(dir, "pnpm-args.txt");
  return {
    ...result,
    pnpmArgs: existsSync(argsPath) ? readFileSync(argsPath, "utf8").trim() : null,
  };
}

/** Drop replacement refs before removing the fixture directory. */
function gitReplacementCleanup(dir) {
  const list = spawnSync("git", ["replace", "-l"], { cwd: dir, encoding: "utf8" });
  if (list.status !== 0) return;
  for (const ref of list.stdout.split("\n").map((line) => line.trim()).filter(Boolean)) {
    spawnSync("git", ["replace", "-d", ref], { cwd: dir });
  }
}

const ZERO = "0".repeat(40);

test("a new branch is diffed against its merge base with main, not skipped", () => {
  const { dir, binDir } = fixture();
  try {
    const local = git(dir, ["rev-parse", "HEAD"]);
    const base = git(dir, ["merge-base", "origin/main", "HEAD"]);
    const result = runHook(dir, binDir, `refs/heads/feature ${local} refs/heads/feature ${ZERO}\n`);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.pnpmArgs, `preflight --base ${base}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an existing remote branch uses the remote commit as the base", () => {
  const { dir, binDir } = fixture();
  try {
    const local = git(dir, ["rev-parse", "HEAD"]);
    const remote = git(dir, ["rev-parse", "HEAD~1"]);
    const result = runHook(dir, binDir, `refs/heads/feature ${local} refs/heads/feature ${remote}\n`);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.pnpmArgs, `preflight --base ${remote}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an existing remote commit that cannot be resolved fails before preflight", () => {
  // A broken local state is not a new branch. Falling back to the merge base
  // here would hide whatever the missing commit contained.
  const { dir, binDir } = fixture();
  try {
    const local = git(dir, ["rev-parse", "HEAD"]);
    const missing = "1".repeat(40);
    const result = runHook(dir, binDir, `refs/heads/feature ${local} refs/heads/feature ${missing}\n`);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(result.pnpmArgs, null);
    assert.match(result.stderr + result.stdout, /cannot resolve remote commit/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a push whose only change is a submodule pointer still runs preflight", () => {
  // A .gitmodules `ignore = all` entry (the normal state for a vendored
  // dependency) removes gitlink records from `git diff`, so the hook used to
  // conclude the push was empty and exit 0 without ever running the gate.
  const { dir, binDir } = fixture();
  const sub = mkdtempSync(join(tmpdir(), "alix-pre-push-sub-"));
  try {
    // A real gitlink: a commit object recorded at mode 160000.
    git(sub, ["init", "-q", "--initial-branch=main"]);
    git(sub, ["config", "user.email", "test@example.com"]);
    git(sub, ["config", "user.name", "Hook Test"]);
    git(sub, ["config", "commit.gpgsign", "false"]);
    writeFileSync(join(sub, "README.md"), "dep\n");
    git(sub, ["add", "-A"]);
    git(sub, ["commit", "-q", "-m", "dep one"]);
    const subSha = git(sub, ["rev-parse", "HEAD"]);

    writeFileSync(join(dir, ".gitmodules"), `[submodule "vend"]\n\tpath = vend\n\turl = .\n\tignore = all\n`);
    git(dir, ["-c", "protocol.file.allow=always", "submodule", "add", "-q", sub, "vend"]);
    git(dir, ["add", ".gitmodules"]);
    git(dir, ["commit", "-q", "-m", "add submodule"]);

    // Baseline: the branch tip the remote already has.
    const remote = git(dir, ["rev-parse", "HEAD"]);
    writeFileSync(join(sub, "README.md"), "dep two\n");
    git(sub, ["commit", "-q", "-am", "dep two"]);
    git(sub, ["config", "user.email", "test@example.com"]);
    const next = git(sub, ["rev-parse", "HEAD"]);
    assert.notEqual(next, subSha);

    git(dir, ["-c", "protocol.file.allow=always", "submodule", "update", "-q", "--remote"]);
    // Stage the gitlink through the index, not `git add vend`.
    //
    // On git 2.56.1 (the CI runner) `git add` honours `.gitmodules` `ignore =
    // all` for an already-tracked gitlink and leaves it unchanged, so the
    // commit below failed with "nothing to commit" and the fixture never built
    // the pointer bump the test is about. `update-index --cacheinfo` writes the
    // index entry directly, and the assertion keeps the fixture's premise from
    // depending on `git add` semantics.
    git(dir, ["update-index", "--cacheinfo", `160000,${next},vend`]);
    assert.equal(
      git(dir, ["ls-files", "-s", "--", "vend"]).split(/\s+/)[1],
      next,
      "fixture must stage the gitlink at the new pointer",
    );
    git(dir, ["commit", "-q", "-m", "bump submodule pointer"]);

    const local = git(dir, ["rev-parse", "HEAD"]);
    // The defect: plain `git diff --quiet` sees nothing here.
    const plain = spawnSync("git", ["diff", "--quiet", `${remote}..${local}`], { cwd: dir });
    assert.equal(plain.status, 0, "fixture must reproduce the invisible gitlink, else it proves nothing");

    const result = runHook(dir, binDir, `refs/heads/feature ${local} refs/heads/feature ${remote}\n`);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.pnpmArgs, `preflight --base ${remote}`, "the hook must run the gate for a gitlink-only push");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(sub, { recursive: true, force: true });
  }
});

test("a replacement ref cannot hand preflight a rewritten base", () => {
  // `git replace <local> <other>` makes merge-base walk substituted history.
  // Measured on this git: the unguarded call returned a commit object that
  // exists only as a replacement synthesis, so the hook passed preflight a base
  // describing a history nobody pushed. The guarded call returns the real merge
  // base. Base selection is part of deciding what changed.
  const { dir, binDir } = fixture();
  try {
    const local = git(dir, ["rev-parse", "HEAD"]);
    const base = git(dir, ["rev-parse", "origin/main"]);
    git(dir, ["replace", local, base]);

    const realBase = spawnSync("git", ["merge-base", "origin/main", local], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, GIT_NO_REPLACE_OBJECTS: "1" },
    }).stdout.trim();
    assert.equal(realBase, base);
    // The fixture must reproduce the substitution, else the assertion below
    // would pass for the wrong reason.
    // Unguarded on purpose. `stepEnv()` in preflight exports
    // `GIT_NO_REPLACE_OBJECTS=1` to every child and this runner inherits it via
    // `process.env`. The key is DELETED, not blanked: git treats an empty value
    // as enabled (measured), so `: ""` would keep the guard on and this fixture
    // would assert nothing.
    const observeEnv = { ...process.env };
    delete observeEnv.GIT_NO_REPLACE_OBJECTS;
    const substituted = spawnSync("git", ["merge-base", "origin/main", local], {
      cwd: dir,
      encoding: "utf8",
      env: observeEnv,
    }).stdout.trim();
    assert.notEqual(substituted, realBase, "fixture must make the unguarded call return a rewritten commit");

    const result = runHook(dir, binDir, `refs/heads/feature ${local} refs/heads/feature ${ZERO}\n`);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.pnpmArgs, `preflight --base ${realBase}`);
  } finally {
    gitReplacementCleanup(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a failing preflight blocks the push", () => {
  const { dir, binDir } = fixture(1);
  try {
    const local = git(dir, ["rev-parse", "HEAD"]);
    const result = runHook(dir, binDir, `refs/heads/feature ${local} refs/heads/feature ${ZERO}\n`);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /preflight failed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a tag push carries no branch diff and is not gated", () => {
  const { dir, binDir } = fixture();
  try {
    const local = git(dir, ["rev-parse", "HEAD"]);
    const result = runHook(dir, binDir, `refs/tags/v1 ${local} refs/tags/v1 ${ZERO}\n`);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.pnpmArgs, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
