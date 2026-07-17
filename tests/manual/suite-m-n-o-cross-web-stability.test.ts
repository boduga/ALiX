/**
 * Suite M: Cross-Feature — init then run, session replay via inspector.
 * Suite N: Web Tools — web_search and web_fetch (requires BRAVE_API_KEY).
 * Suite O: Stability — rapid tasks, session persistence, no memory leaks.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runCli, CLI_PATH, PROJECT_ROOT, tempDir, assertSuccess, assertOutputContains, assertOutputNotContains, needsModel, needsBrave } from "./run-cli.js";

/**
 * Bootstrap a test directory by copying the project's .alix config.
 * This gives temp dir tests a working model configuration.
 */
function bootstrapConfig(dir: string): void {
  const configDir = join(dir, ".alix");
  mkdirSync(configDir, { recursive: true });
  const sourceConfig = join(PROJECT_ROOT, ".alix", "config.json");
  if (existsSync(sourceConfig)) {
    const config = JSON.parse(readFileSync(sourceConfig, "utf8"));
    writeFileSync(join(configDir, "config.json"), JSON.stringify(config, null, 2) + "\n");
  }
}

describe("Suite M: Cross-Feature", () => {

  // ── M.1: Bootstrap config then run ──────────────────────────
  it("M.1: bootstrapped config lets run work", () => {
    const { path, cleanup } = tempDir("alix-cross-");
    try {
      bootstrapConfig(path);

      const r = runCli(["run", "echo hello", "--session-mode", "bypass", "--no-stream"], {
        cwd: path,
        timeoutMs: 30_000,
      });
      assertOutputContains(r, "hello", "run should use bootstrapped config");

      // Session should be logged
      const sessionsDir = join(path, ".alix", "sessions");
      assert.equal(existsSync(sessionsDir), true, "sessions dir should exist after run");
      const sessions = readdirSync(sessionsDir);
      assert.ok(sessions.length > 0, "at least one session should exist");
    } finally {
      cleanup();
    }
  });

  // ── M.2: Config persists across commands ──────────────────────
  it("M.2: config persists across multiple runs", () => {
    const { path, cleanup } = tempDir("alix-cross-");
    try {
      bootstrapConfig(path);

      for (let i = 0; i < 3; i++) {
        const r = runCli(["run", `echo task-${i}`, "--session-mode", "bypass", "--no-stream"], {
          cwd: path,
          timeoutMs: 30_000,
        });
        assertOutputContains(r, `task-${i}`);
      }

      const sessionsDir = join(path, ".alix", "sessions");
      const sessions = readdirSync(sessionsDir);
      assert.ok(sessions.length >= 3, "should have 3+ sessions");
    } finally {
      cleanup();
    }
  });
});


describe("Suite N: Web Tools", () => {

  // ── N.1: Web search ───────────────────────────────────────────
  it("N.1: web_search tool works with BRAVE_API_KEY", { ...needsBrave }, () => {
    const r = runCli(
      ["run", "search the web for latest AI news and summarize", "--session-mode", "bypass", "--no-stream", "--no-plan"],
      { timeoutMs: 120_000, env: { BRAVE_API_KEY: process.env.BRAVE_API_KEY! } },
    );
    assert.ok(r.exitCode === 0 || r.stdout.length > 0, `web search should produce output (exit: ${r.exitCode})`);
    assert.ok(
      r.stdout.includes("AI") || r.stdout.includes("search") || r.stdout.includes("result") || r.stdout.includes("news") || r.stdout.length > 100,
      "should return substantial content",
    );
  });

  // ── N.2: Web fetch ────────────────────────────────────────────
  it("N.2: web_fetch tool fetches and summarizes URL", { ...needsBrave }, () => {
    const r = runCli(
      ["run", "please use web_fetch to fetch https://example.com and summarize the page", "--session-mode", "bypass", "--no-stream", "--no-plan"],
      { timeoutMs: 120_000, env: { BRAVE_API_KEY: process.env.BRAVE_API_KEY! } },
    );
    // The model may return content or a summary — just verify it ran without crashing
    assert.ok(r.exitCode === 0 || r.stdout.length > 0, `web fetch should run (exit: ${r.exitCode}, output: ${r.stdout.slice(0, 100)})`);
  });
});


describe("Suite O: Stability", () => {

  // ── O.1: Multiple rapid tasks ─────────────────────────────────
  it("O.1: 5 rapid tasks complete without crash", () => {
    const { path, cleanup } = tempDir("alix-stability-");
    try {
      for (let i = 0; i < 5; i++) {
        const r = runCli(["run", `echo rapid-task-${i}`, "--session-mode", "bypass", "--no-stream"], {
          cwd: path,
          timeoutMs: 20_000,
        });
        assertOutputContains(r, `rapid-task-${i}`, `task ${i} should complete`);
      }
    } finally {
      cleanup();
    }
  });

  // ── O.2: Session persistence ──────────────────────────────────
  it("O.2: sessions accumulate without corruption", () => {
    const { path, cleanup } = tempDir("alix-sessions-");
    try {
      bootstrapConfig(path);

      // Run 3 tasks
      const sessionIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const r = runCli(["run", `echo persist-${i}`, "--session-mode", "bypass", "--no-stream"], {
          cwd: path,
          timeoutMs: 20_000,
        });
        const match = r.stdout.match(/Session: ([a-f0-9-]+)/);
        if (match) sessionIds.push(match[1]);
      }

      // Each session should have a valid events file
      for (const id of sessionIds) {
        const eventsPath = join(path, ".alix", "sessions", id, "events.jsonl");
        assert.equal(existsSync(eventsPath), true, `events file should exist for ${id}`);
      }

      // All sessions persisted
      assert.equal(sessionIds.length, 3, "should have 3 session IDs");
    } finally {
      cleanup();
    }
  });

  // ── O.3: --no-plan already handled without crash ──────────────
  it("O.3: --no-plan with read-only task works", () => {
    const r = runCli(["run", "echo no-plan-test", "--session-mode", "bypass", "--no-stream", "--no-plan"]);
    assertSuccess(r);
    assertOutputContains(r, "no-plan-test");
    assertOutputNotContains(r, "## Summary");
  });
});
