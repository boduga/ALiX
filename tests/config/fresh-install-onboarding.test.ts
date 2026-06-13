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

/**
 * Run a test function with a scoped working directory.
 * The test fixture config is written at <dir>/.alix/config.json,
 * and handleModels* commands call loadConfig(process.cwd()), so
 * we chdir into dir to ensure they read the test fixture.
 */
async function withScopedCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prevCwd = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(prevCwd);
  }
}

/**
 * Save env vars before deletion, restore them after the test.
 */
function withSavedEnv<T>(keys: string[], fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const key of keys) {
    saved[key] = process.env[key];
  }
  for (const key of keys) {
    delete process.env[key];
  }
  return Promise.resolve().then(fn).finally(() => {
    for (const key of keys) {
      if (saved[key] !== undefined) {
        process.env[key] = saved[key];
      } else {
        delete process.env[key];
      }
    }
  });
}

/** Minimal config with empty model name — simulates incomplete setup. */
const INCOMPLETE_CONFIG = {
  model: { provider: "ollama", name: "" },
  permissions: { default: "ask", tools: {}, protectedPaths: [] },
  context: { repoMap: false, repoMapMode: "lite", maxRepoMapTokens: 0, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] },
  runtime: { provider: "process", shell: "/bin/bash", commandTimeoutMs: 10000, envAllowlist: [] },
  ui: { enabled: false, host: "", port: 0, transport: "sse" },
};

// ── 1. init with Ollama detected but no models does not write an empty model ──

test("init with Ollama fallback and no installed models writes no model at all", { timeout: 15_000 }, async () => {
  const keys = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "DEEPSEEK_API_KEY", "OLLAMA_API_KEY"];
  await withSavedEnv(keys, async () => {
    await withTempDir(async (dir) => {
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
});

// ── 2. models doctor works with incomplete model config ──

test("models doctor works with incomplete model config", { timeout: 15_000 }, async () => {
  await withTempDir(async (dir) => {
    await mkdirAsync(join(dir, ".alix"), { recursive: true });
    await writeFileAsync(
      join(dir, ".alix", "config.json"),
      JSON.stringify(INCOMPLETE_CONFIG)
    );

    const { handleModelsDoctor } = await import("../../src/cli/commands/models.js");
    // handler calls loadConfig(process.cwd()) — scope cwd to fixture dir
    await withScopedCwd(dir, async () => {
      await handleModelsDoctor(["--json"]);
    });
  });
});

// ── 3. models fit works with incomplete model config ──

test("models fit works with incomplete model config", { timeout: 15_000 }, async () => {
  await withTempDir(async (dir) => {
    await mkdirAsync(join(dir, ".alix"), { recursive: true });
    await writeFileAsync(
      join(dir, ".alix", "config.json"),
      JSON.stringify(INCOMPLETE_CONFIG)
    );

    const { handleModelsFit } = await import("../../src/cli/commands/models.js");
    await withScopedCwd(dir, async () => {
      await handleModelsFit(["--json"]);
    });
  });
});

// ── 4. models list-profiles works before a model is selected ──

test("models list-profiles works with incomplete model config", { timeout: 15_000 }, async () => {
  await withTempDir(async (dir) => {
    await mkdirAsync(join(dir, ".alix"), { recursive: true });
    await writeFileAsync(
      join(dir, ".alix", "config.json"),
      JSON.stringify(INCOMPLETE_CONFIG)
    );

    const { handleModelsList } = await import("../../src/cli/commands/models.js");
    await withScopedCwd(dir, async () => {
      await handleModelsList(["--json"]);
    });
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
      JSON.stringify(INCOMPLETE_CONFIG)
    );

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: string[]) => logs.push(args.join(" "));

    try {
      const { handleModelsDoctor } = await import("../../src/cli/commands/models.js");
      await withScopedCwd(dir, async () => {
        await handleModelsDoctor([]);
      });
      const output = logs.join("\n");
      assert.ok(output.includes("Profile"), "doctor output should mention profiles");
    } finally {
      console.log = origLog;
    }
  });
});

// ── 7. End-to-end acceptance: init → doctor → fit → install-profile --dry-run ──

test("end-to-end: init then doctor then fit then install-profile --dry-run", { timeout: 15_000 }, async () => {
  const keys = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "DEEPSEEK_API_KEY", "OLLAMA_API_KEY"];
  await withSavedEnv(keys, async () => {
    await withTempDir(async (dir) => {
      // Step 1: init
      const { runInit } = await import("../../src/cli/commands/init.js");
      await runInit(dir);

      // Verify config is valid (model.name not empty if set)
      const configPath = join(dir, ".alix", "config.json");
      const config = JSON.parse(await readFileAsync(configPath, "utf8"));
      if (config.model.name !== undefined) {
        assert.notEqual(config.model.name, "", "model.name must not be empty after init");
      }

      // Step 2-4: doctor, fit, apply-profile (scoped cwd so handlers read fresh fixture)
      const { handleModelsDoctor, handleModelsFit, handleModelsApply } = await import("../../src/cli/commands/models.js");
      await withScopedCwd(dir, async () => {
        await handleModelsDoctor(["--json"]);
        await handleModelsFit(["--json"]);
        await handleModelsApply(["minimal-local", "--dry-run"]);
      });
    });
  });
});
