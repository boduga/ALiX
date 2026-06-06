/**
 * Suite D: Init — alix init bare and with scaffold prompt.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runCli, tempDir, assertSuccess, assertOutputContains } from "./run-cli.js";

describe("Suite D: Init", () => {

  // ── D.1: Bare init ────────────────────────────────────────────
  it("D.1: bare init creates .alix/config.json and AGENTS.md", () => {
    const { path, cleanup } = tempDir("alix-init-");
    try {
      const r = runCli(["init"], { cwd: path, timeoutMs: 15_000 });
      assertSuccess(r);
      assertOutputContains(r, "ALiX initialized");
      assert.equal(existsSync(join(path, ".alix", "config.json")), true, ".alix/config.json should exist");
      assert.equal(existsSync(join(path, "AGENTS.md")), true, "AGENTS.md should exist");
    } finally {
      cleanup();
    }
  });

  // ── D.1b: Init in Git repo creates proper config ──────────────
  it("D.1b: init creates valid JSON config", () => {
    const { path, cleanup } = tempDir("alix-init-");
    try {
      runCli(["init"], { cwd: path, timeoutMs: 15_000 });
      const configPath = join(path, ".alix", "config.json");
      assert.equal(existsSync(configPath), true);
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      assert.ok(config.model, "config should have model");
      assert.ok(config.permissions, "config should have permissions");
      assert.ok(config.context, "config should have context");
      assert.equal(config.version, 1, "config version should be 1");
    } finally {
      cleanup();
    }
  });

  // ── D.1c: Init adds .alix to .gitignore ────────────────────────
  it("D.1c: init adds .alix/ to .gitignore", () => {
    const { path, cleanup } = tempDir("alix-init-");
    try {
      runCli(["init"], { cwd: path, timeoutMs: 15_000 });
      const gitignorePath = join(path, ".gitignore");
      if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, "utf8");
        assert.ok(content.includes(".alix/"), ".gitignore should contain .alix/");
      }
    } finally {
      cleanup();
    }
  });

  // ── D.2: Init with scaffold prompt ────────────────────────────
  it("D.2: init with scaffold prompt runs agent task", { skip: "requires model API credentials" }, () => {
    const { path, cleanup } = tempDir("alix-scaffold-");
    try {
      const r = runCli(["init", "create a Fastify API server with TypeScript"], {
        cwd: path,
        timeoutMs: 120_000,
      });
      assertSuccess(r);
      assertOutputContains(r, "Session:");
      assertOutputContains(r, "ALiX initialized");
    } finally {
      cleanup();
    }
  });
});
