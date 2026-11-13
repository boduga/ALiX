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
