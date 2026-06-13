import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir as mkdirAsync, readFile as readFileAsync, rm as rmAsync, writeFile as writeFileAsync } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL("..", import.meta.url));

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = join(__dirname, ".tmp-init-" + Date.now());
  await mkdirAsync(dir, { recursive: true });
  try {
    return await fn(dir);
  } finally {
    await rmAsync(dir, { recursive: true, force: true });
  }
}

test("runInit is exported and callable", { timeout: 10_000 }, async () => {
  const mod = await import("../../src/cli/commands/init.js");
  assert.ok("runInit" in mod, "runInit should be exported from init.js");
  assert.equal(typeof mod.runInit, "function", "runInit should be a function");
});

test("runInit creates .alix/config.json", { timeout: 10_000 }, async () => {
  await withTempDir(async (dir) => {
    const configPath = join(dir, ".alix", "config.json");
    assert.ok(!existsSync(configPath));

    const { runInit } = await import("../../src/cli/commands/init.js");
    await runInit(dir);

    assert.ok(existsSync(configPath), ".alix/config.json should be created");
    const content = JSON.parse(await readFileAsync(configPath, "utf8"));
    assert.ok(content.model, "config should have model field");
    // Model may be populated (Ollama present with models) or empty (no Ollama / no models).
    // The invariant: if model.name is set, it must not be empty.
    if (content.model.provider !== undefined) {
      assert.equal(typeof content.model.provider, "string", "model.provider should be a string");
      assert.notEqual(content.model.provider, "", "model.provider must not be empty");
    }
    if (content.model.name !== undefined) {
      assert.equal(typeof content.model.name, "string", "model.name should be a string");
      assert.notEqual(content.model.name, "", "model.name must not be empty");
    }
  });
});

test("runInit detects project type when package.json exists", { timeout: 10_000 }, async () => {
  await withTempDir(async (dir) => {
    await writeFileAsync(join(dir, "package.json"), '{"name":"test"}');

    const { runInit } = await import("../../src/cli/commands/init.js");
    await runInit(dir);

    assert.ok(existsSync(join(dir, ".alix", "config.json")));
  });
});

test("runInit completes when existing .alix/config.json is present", { timeout: 10_000 }, async () => {
  await withTempDir(async (dir) => {
    const configPath = join(dir, ".alix", "config.json");
    await mkdirAsync(join(dir, ".alix"), { recursive: true });
    await writeFileAsync(configPath, JSON.stringify({ model: { provider: "anthropic" } }), "utf8");

    const { runInit } = await import("../../src/cli/commands/init.js");
    await runInit(dir);
    assert.ok(existsSync(configPath));
  });
});

test("runInit auto-inits git and creates .gitignore with .alix/", { timeout: 10_000 }, async () => {
  await withTempDir(async (dir) => {
    const gitignorePath = join(dir, ".gitignore");
    const gitDir = join(dir, ".git");
    assert.ok(!existsSync(gitignorePath), "should start with no .gitignore");
    assert.ok(!existsSync(gitDir), "should start with no .git");

    const { runInit } = await import("../../src/cli/commands/init.js");
    await runInit(dir);

    assert.ok(existsSync(gitDir), ".git should be created");
    assert.ok(existsSync(gitignorePath), ".gitignore should be created");
    const content = await readFileAsync(gitignorePath, "utf8");
    assert.ok(content.includes(".alix/"), ".gitignore should contain .alix/");
  });
});

test("runInit creates AGENTS.md", { timeout: 10_000 }, async () => {
  await withTempDir(async (dir) => {
    const agentsPath = join(dir, "AGENTS.md");
    assert.ok(!existsSync(agentsPath), "should start with no AGENTS.md");

    const { runInit } = await import("../../src/cli/commands/init.js");
    await runInit(dir);

    assert.ok(existsSync(agentsPath), "AGENTS.md should be created");
    const content = await readFileAsync(agentsPath, "utf8");
    assert.ok(content.includes("ALiX"), "AGENTS.md should mention ALiX");
  });
});

test("runInit detects provider from environment", { timeout: 10_000 }, async () => {
  await withTempDir(async (dir) => {
    // Set a fake API key to test provider detection
    process.env.ANTHROPIC_API_KEY = "test-key";

    const { runInit } = await import("../../src/cli/commands/init.js");
    await runInit(dir);

    const configPath = join(dir, ".alix", "config.json");
    const content = JSON.parse(await readFileAsync(configPath, "utf8"));
    assert.strictEqual(content.model.provider, "anthropic", "should detect anthropic from env");

    // Clean up
    delete process.env.ANTHROPIC_API_KEY;
  });
});