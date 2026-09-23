/**
 * config-scope.test.ts — `alix config --global` vs the default project scope.
 *
 * Runs the real CLI in a subprocess with a sandboxed HOME so the user config
 * (the loader's first read) is isolated from the developer's machine.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Locate `dist/src/cli.js` by walking up from this file. Counting `..`
 * segments is fragile (it depends on the test's directory depth), so anchor on
 * the artifact itself.
 */
function findCliPath(): string {
  let dir = fileURLToPath(new URL(".", import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, "src", "cli.js");
    if (existsSync(candidate)) return candidate;
    dir = resolve(dir, "..");
  }
  throw new Error("could not locate dist/src/cli.js from the compiled test");
}

const cliPath = findCliPath();

function runCli(args: string[], dirs: { cwd: string; home: string }) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: dirs.cwd,
    encoding: "utf8",
    env: { ...process.env, HOME: dirs.home },
  });
}

function userConfigPath(home: string): string {
  return join(home, ".config", "alix", "config.json");
}

function projectConfigPath(cwd: string): string {
  return join(cwd, ".alix", "config.json");
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function sandbox(): { cwd: string; home: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "alix-config-scope-"));
  const cwd = join(root, "proj");
  const home = join(root, "home");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(home, { recursive: true });
  return { cwd, home, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("--global writes the user config and creates it when missing", () => {
  const { cwd, home, cleanup } = sandbox();
  try {
    assert.equal(existsSync(userConfigPath(home)), false);

    const result = runCli(["config", "set", "decision.remote.jev.enabled", "true", "--global"], { cwd, home });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\(user\)/);

    const user = readJson(userConfigPath(home));
    const decision = user.decision as { remote?: { jev?: { enabled?: boolean } } };
    assert.equal(decision.remote?.jev?.enabled, true);
    // The project config is untouched.
    assert.equal(existsSync(projectConfigPath(cwd)), false);
  } finally {
    cleanup();
  }
});

test("--user is an alias for --global", () => {
  const { cwd, home, cleanup } = sandbox();
  try {
    const result = runCli(["config", "set", "decision.remote.jev.enabled", "true", "--user"], { cwd, home });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(userConfigPath(home)), true);
    assert.equal(existsSync(projectConfigPath(cwd)), false);
  } finally {
    cleanup();
  }
});

test("the default scope still writes the project config", () => {
  const { cwd, home, cleanup } = sandbox();
  try {
    mkdirSync(join(cwd, ".alix"), { recursive: true });
    writeFileSync(projectConfigPath(cwd), "{}\n", "utf8");

    const result = runCli(["config", "set", "decision.remote.jev.enabled", "true"], { cwd, home });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\(project\)/);

    assert.equal(existsSync(userConfigPath(home)), false);
    const project = readJson(projectConfigPath(cwd));
    const decision = project.decision as { remote?: { jev?: { enabled?: boolean } } };
    assert.equal(decision.remote?.jev?.enabled, true);
  } finally {
    cleanup();
  }
});

test("project config overrides the global value at read time", () => {
  const { cwd, home, cleanup } = sandbox();
  try {
    mkdirSync(join(cwd, ".alix"), { recursive: true });
    writeFileSync(projectConfigPath(cwd), "{}\n", "utf8");

    assert.equal(runCli(["config", "set", "decision.remote.jev.enabled", "true", "--global"], { cwd, home }).status, 0);
    assert.equal(runCli(["config", "set", "decision.remote.jev.enabled", "false"], { cwd, home }).status, 0);

    // Merged (project wins) vs the raw user value.
    const merged = runCli(["config", "get", "decision.remote.jev.enabled"], { cwd, home });
    assert.equal(merged.stdout.trim(), "false");
    const global = runCli(["config", "get", "decision.remote.jev.enabled", "--global"], { cwd, home });
    assert.equal(global.stdout.trim(), "true");
  } finally {
    cleanup();
  }
});

test("--global delete removes only the user value", () => {
  const { cwd, home, cleanup } = sandbox();
  try {
    mkdirSync(join(cwd, ".alix"), { recursive: true });
    writeFileSync(projectConfigPath(cwd), "{}\n", "utf8");
    assert.equal(runCli(["config", "set", "decision.remote.jev.enabled", "true", "--global"], { cwd, home }).status, 0);
    assert.equal(runCli(["config", "set", "decision.remote.jev.enabled", "false"], { cwd, home }).status, 0);

    const deleted = runCli(["config", "delete", "decision.remote.jev.enabled", "--global"], { cwd, home });
    assert.equal(deleted.status, 0, deleted.stderr);
    assert.match(deleted.stdout, /\(user\)/);

    const global = runCli(["config", "get", "decision.remote.jev.enabled", "--global"], { cwd, home });
    assert.equal(global.stdout.trim(), "(not set)");
    // The project value survives.
    assert.equal(runCli(["config", "get", "decision.remote.jev.enabled"], { cwd, home }).stdout.trim(), "false");
  } finally {
    cleanup();
  }
});

test("--global and --project together are rejected", () => {
  const { cwd, home, cleanup } = sandbox();
  try {
    const result = runCli(["config", "set", "decision.remote.jev.enabled", "true", "--global", "--project"], { cwd, home });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /either --global or --project/);
  } finally {
    cleanup();
  }
});

test("config get works before any model is configured", () => {
  const { cwd, home, cleanup } = sandbox();
  try {
    mkdirSync(join(cwd, ".alix"), { recursive: true });
    writeFileSync(projectConfigPath(cwd), "{}\n", "utf8");

    const result = runCli(["config", "get", "decision.remote.jev.enabled"], { cwd, home });
    assert.equal(result.status, 0, result.stderr);
    // Merged read: the effective value comes from DEFAULT_CONFIG (false).
    assert.equal(result.stdout.trim(), "false");
    // The raw user scope reports only what is explicitly set.
    const global = runCli(["config", "get", "decision.remote.jev.enabled", "--global"], { cwd, home });
    assert.equal(global.stdout.trim(), "(not set)");
    assert.doesNotMatch(result.stderr, /No model configured/);
  } finally {
    cleanup();
  }
});
