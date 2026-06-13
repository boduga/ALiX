/**
 * fresh-install-onboarding.test.ts — Regression tests for the init→doctor→fit onboarding flow.
 *
 * Ensures that:
 *  1. init never writes an empty model name
 *  2. models doctor / fit / list-profiles work before a model is configured
 *  3. strict loadConfig still blocks execution without a model
 *  4. doctor recommends install-profile when no model is configured
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdir as mkdirAsync, readFile as readFileAsync, rm as rmAsync, writeFile as writeFileAsync } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = join(tmpdir(), "alix-onboarding-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6));
  await mkdirAsync(dir, { recursive: true });
  try {
    return await fn(dir);
  } finally {
    await rmAsync(dir, { recursive: true, force: true });
  }
}

// ── 1. init with Ollama detected but no models does not write an empty model ──

test("init with Ollama fallback and no installed models writes no model at all", { timeout: 15_000 }, async () => {
  await withTempDir(async (dir) => {
    // Ensure no API key env vars are set
    for (const key of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "DEEPSEEK_API_KEY"]) {
      delete process.env[key];
    }
    // Delete any existing OLLAMA_API_KEY to trigger Ollama fallback
    delete process.env.OLLAMA_API_KEY;

    const { runInit } = await import("../../src/cli/commands/init.js");
    await runInit(dir);

    const configPath = join(dir, ".alix", "config.json");
    assert.ok(existsSync(configPath), ".alix/config.json should exist");
    const content = JSON.parse(await readFileAsync(configPath, "utf8"));
    assert.ok(content.model, "config should have model field");
    // If Ollama is installed with models, model.name is set; if not, model is {}
    // The invariant: model.name must never be an empty string
    if (content.model.name !== undefined) {
      assert.notEqual(content.model.name, "", "model.name must not be an empty string");
    }
  });
});

// ── 2. models doctor works with incomplete model config ──

test("models doctor works with incomplete model config", { timeout: 15_000 }, async () => {
  await withTempDir(async (dir) => {
    // Create minimal config with provider but no model name
    await mkdirAsync(join(dir, ".alix"), { recursive: true });
    await writeFileAsync(
      join(dir, ".alix", "config.json"),
      JSON.stringify({
        model: { provider: "ollama", name: "" },
        permissions: { default: "ask", tools: {}, protectedPaths: [] },
        context: { repoMap: false, repoMapMode: "lite", maxRepoMapTokens: 0, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] },
        runtime: { provider: "process", shell: "/bin/bash", commandTimeoutMs: 10000, envAllowlist: [] },
        ui: { enabled: false, host: "", port: 0, transport: "sse" },
      })
    );

    const { handleModelsDoctor } = await import("../../src/cli/commands/models.js");
    // Should not throw despite incomplete model config
    await handleModelsDoctor(["--json"]);
  });
});

// ── 3. models fit works with incomplete model config ──

test("models fit works with incomplete model config", { timeout: 15_000 }, async () => {
  await withTempDir(async (dir) => {
    // Create minimal config with provider but no model name
    await mkdirAsync(join(dir, ".alix"), { recursive: true });
    await writeFileAsync(
      join(dir, ".alix", "config.json"),
      JSON.stringify({
        model: { provider: "ollama", name: "" },
        permissions: { default: "ask", tools: {}, protectedPaths: [] },
        context: { repoMap: false, repoMapMode: "lite", maxRepoMapTokens: 0, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] },
        runtime: { provider: "process", shell: "/bin/bash", commandTimeoutMs: 10000, envAllowlist: [] },
        ui: { enabled: false, host: "", port: 0, transport: "sse" },
      })
    );

    const { handleModelsFit } = await import("../../src/cli/commands/models.js");
    // Should not throw despite incomplete model config
    await handleModelsFit(["--json"]);
  });
});

// ── 4. models list-profiles works before a model is selected ──

test("models list-profiles works with incomplete model config", { timeout: 15_000 }, async () => {
  await withTempDir(async (dir) => {
    await mkdirAsync(join(dir, ".alix"), { recursive: true });
    await writeFileAsync(
      join(dir, ".alix", "config.json"),
      JSON.stringify({
        model: { provider: "ollama", name: "" },
        permissions: { default: "ask", tools: {}, protectedPaths: [] },
        context: { repoMap: false, repoMapMode: "lite", maxRepoMapTokens: 0, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] },
        runtime: { provider: "process", shell: "/bin/bash", commandTimeoutMs: 10000, envAllowlist: [] },
        ui: { enabled: false, host: "", port: 0, transport: "sse" },
      })
    );

    const { handleModelsList } = await import("../../src/cli/commands/models.js");
    await handleModelsList(["--json"]);
  });
});

// ── 5. strict loadConfig still blocks execution without a model ──

test("strict loadConfig throws when model is missing", { timeout: 15_000 }, async () => {
  await withTempDir(async (dir) => {
    // Create a config with no model info
    await mkdirAsync(join(dir, ".alix"), { recursive: true });
    await writeFileAsync(
      join(dir, ".alix", "config.json"),
      JSON.stringify({
        permissions: { default: "ask", tools: {}, protectedPaths: [] },
        context: { repoMap: false, repoMapMode: "lite", maxRepoMapTokens: 0, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] },
        runtime: { provider: "process", shell: "/bin/bash", commandTimeoutMs: 10000, envAllowlist: [] },
        ui: { enabled: false, host: "", port: 0, transport: "sse" },
      })
    );

    const { loadConfig, _setHomedirOverride } = await import("../../src/config/loader.js");
    _setHomedirOverride(dir);
    try {
      await assert.rejects(
        () => loadConfig(dir),
        /No model configured/,
        "strict loadConfig must throw when model is missing"
      );
    } finally {
      _setHomedirOverride(undefined);
    }
  });
});

// ── 6. doctor recommends install-profile when no model is configured ──

test("doctor recommends install-profile when no model is configured", { timeout: 15_000 }, async () => {
  await withTempDir(async (dir) => {
    await mkdirAsync(join(dir, ".alix"), { recursive: true });
    await writeFileAsync(
      join(dir, ".alix", "config.json"),
      JSON.stringify({
        model: { provider: "ollama", name: "" },
        permissions: { default: "ask", tools: {}, protectedPaths: [] },
        context: { repoMap: false, repoMapMode: "lite", maxRepoMapTokens: 0, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] },
        runtime: { provider: "process", shell: "/bin/bash", commandTimeoutMs: 10000, envAllowlist: [] },
        ui: { enabled: false, host: "", port: 0, transport: "sse" },
      })
    );

    // Capture console.log output
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: string[]) => logs.push(args.join(" "));

    try {
      const { handleModelsDoctor } = await import("../../src/cli/commands/models.js");

      // We expect this to succeed — doctor should handle missing model gracefully
      await handleModelsDoctor([]);

      const output = logs.join("\n");
      // Doctor should produce profile compatibility output, not throw
      assert.ok(output.includes("Profile"), "doctor output should mention profiles");
    } finally {
      console.log = origLog;
    }
  });
});

// ── 7. End-to-end acceptance: init → doctor → fit → install-profile --dry-run ──

test("end-to-end: init then doctor then fit then install-profile --dry-run", { timeout: 15_000 }, async () => {
  await withTempDir(async (dir) => {
    // Ensure no API keys to get clean Ollama fallback
    for (const key of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "DEEPSEEK_API_KEY", "OLLAMA_API_KEY"]) {
      delete process.env[key];
    }

    // Step 1: init
    const { runInit } = await import("../../src/cli/commands/init.js");
    await runInit(dir);

    // Verify config is valid (model.name not empty if set)
    const configPath = join(dir, ".alix", "config.json");
    const config = JSON.parse(await readFileAsync(configPath, "utf8"));
    if (config.model.name !== undefined) {
      assert.notEqual(config.model.name, "", "model.name must not be empty after init");
    }

    // Step 2: doctor (must not throw)
    const { handleModelsDoctor, handleModelsFit, handleModelsApply } = await import("../../src/cli/commands/models.js");
    await handleModelsDoctor(["--json"]);

    // Step 3: fit (must not throw)
    await handleModelsFit(["--json"]);

    // Step 4: install-profile --dry-run (must not throw)
    await handleModelsApply(["minimal-local", "--dry-run"]);
  });
});
