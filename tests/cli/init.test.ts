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
    // §7.2/§7.4: canonical persistence — model selection under models.default
    // only; init never writes the model/subagents projections.
    assert.ok(content.models, "config should have models field");
    assert.ok(content.models.default, "config should have models.default");
    // Model may be populated (Ollama present with models) or empty (no Ollama / no models).
    // The invariant: if model.name is set, it must not be empty.
    if (content.models.default.provider !== undefined) {
      assert.equal(typeof content.models.default.provider, "string", "models.default.provider should be a string");
      assert.notEqual(content.models.default.provider, "", "models.default.provider must not be empty");
    }
    if (content.models.default.name !== undefined) {
      assert.equal(typeof content.models.default.name, "string", "models.default.name should be a string");
      assert.notEqual(content.models.default.name, "", "models.default.name must not be empty");
    }
    assert.equal(content.model, undefined, "disk must contain no top-level model projection");
    assert.equal(content.subagents, undefined, "disk must contain no top-level subagents projection");
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
    assert.strictEqual(content.models.default.provider, "anthropic", "should detect anthropic from env");
    assert.equal(content.model, undefined, "disk must contain no top-level model projection");
    assert.equal(content.subagents, undefined, "disk must contain no top-level subagents projection");

    // Clean up
    delete process.env.ANTHROPIC_API_KEY;
  });
});

test("runInit writes canonical models that loadConfig re-projects (§7.4 round-trip)", { timeout: 10_000 }, async () => {
  await withTempDir(async (dir) => {
    process.env.ANTHROPIC_API_KEY = "test-key";

    const { runInit } = await import("../../src/cli/commands/init.js");
    await runInit(dir);

    // Half 1: init wrote a canonical disk representation (models only).
    const configPath = join(dir, ".alix", "config.json");
    const saved = JSON.parse(await readFileAsync(configPath, "utf8"));
    assert.ok(saved.models?.default);
    assert.equal(saved.model, undefined);
    assert.equal(saved.subagents, undefined);

    // Half 2: loading it re-derives the runtime compatibility projections.
    const { loadConfig, _setHomedirOverride } = await import("../../src/config/loader.js");
    _setHomedirOverride(join(dir, ".tmp-homedir")); // isolate from the real user config
    try {
      const loaded = await loadConfig(dir);
      assert.equal(loaded.model?.provider, saved.models.default.provider, "model projection re-derived");
      assert.ok(loaded.subagents, "subagents projection re-derived");
      assert.equal(loaded.subagents?.coding?.name, loaded.models?.default?.name, "tier falls back to default");
    } finally {
      _setHomedirOverride(undefined);
    }

    delete process.env.ANTHROPIC_API_KEY;
  });
});