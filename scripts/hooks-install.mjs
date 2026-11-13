#!/usr/bin/env node
/**
 * hooks-install.mjs — point this checkout at the checked-in `.githooks/`.
 *
 * `git config core.hooksPath` is local state, so it cannot be committed. This
 * command is the committed half: it makes the hook reproducible from the repo
 * without adding a `prepare` script that would silently rewrite hooks for
 * every consumer of the package.
 *
 * Usage: node scripts/hooks-install.mjs [--check]
 * Exit codes: 0 installed (or already correct), 1 not installed with --check, 2 error.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const HOOKS_DIR = join(ROOT, ".githooks");
const checkOnly = process.argv.includes("--check");

try {
  const current = execFileSync("git", ["config", "--get", "core.hooksPath"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  if (current === HOOKS_DIR || current === ".githooks") {
    console.log(`Hooks already installed (core.hooksPath=${current}).`);
    process.exit(0);
  }
} catch {
  // Unset: fall through and install.
}

if (checkOnly) {
  console.error("Hooks are NOT installed. Run `pnpm hooks:install`.");
  process.exit(1);
}

if (!existsSync(join(HOOKS_DIR, "pre-push"))) {
  console.error("scripts/hooks-install.mjs: .githooks/pre-push is missing.");
  process.exit(2);
}

execFileSync("git", ["config", "core.hooksPath", ".githooks"], { cwd: ROOT, stdio: "inherit" });
console.log("Installed hooks: core.hooksPath=.githooks (pre-push runs `pnpm preflight`).");
console.log("Skip a single push with `git push --no-verify`, or a whole run with ALIX_SKIP_PREFLIGHT=1.");
