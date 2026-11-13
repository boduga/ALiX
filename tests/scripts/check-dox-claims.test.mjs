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



test("a replacement ref cannot hide an added contract claim", () => {
  // The DOX audit's scope is "lines the branch ADDS relative to base". A
  // replacement ref rewrites the base's tree, so the range diff can drop the
  // AGENTS.md hunk while another file still differs -- `anyChangedFiles` is then
  // non-empty and the run reports CLEAN for a claim it never read. That is a
  // false pass, so the diff must not be substitutable.
  const dir = mkdtempSync(join(tmpdir(), "alix-dox-replace-"));
  const env = { ...GIT_ENV };
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
