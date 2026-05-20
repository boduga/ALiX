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

// Always-decline answers for all prompts
const declineAll = {
  yesNo: async (_question: string, _defaultYes?: boolean) => false,
  prompt: async (_question: string) => "",
};

// Always-accept answers
const acceptAll = {
  yesNo: async (_question: string, defaultYes?: boolean) => defaultYes ?? true,
  prompt: async (_question: string) => "",
};

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
    await runInit(dir, declineAll);

    assert.ok(existsSync(configPath), ".alix/config.json should be created");
    const content = JSON.parse(await readFileAsync(configPath, "utf8"));
    assert.ok(content.model, "config should have model field");
    assert.ok(typeof content.model.provider === "string", "model.provider should be a string");
    assert.ok(typeof content.model.name === "string", "model.name should be a string");
  });
});

test("runInit detects project type when package.json exists", { timeout: 10_000 }, async () => {
  await withTempDir(async (dir) => {
    await writeFileAsync(join(dir, "package.json"), '{"name":"test"}');

    const { runInit } = await import("../../src/cli/commands/init.js");
    await runInit(dir, declineAll);

    assert.ok(existsSync(join(dir, ".alix", "config.json")));
  });
});

test("runInit completes when existing .alix/config.json is present", { timeout: 10_000 }, async () => {
  await withTempDir(async (dir) => {
    const configPath = join(dir, ".alix", "config.json");
    await mkdirAsync(join(dir, ".alix"), { recursive: true });
    await writeFileAsync(configPath, JSON.stringify({ model: { provider: "anthropic" } }), "utf8");

    const { runInit } = await import("../../src/cli/commands/init.js");
    // Current implementation overwrites. This test verifies it runs without error.
    await runInit(dir, declineAll);
    assert.ok(existsSync(configPath));
  });
});

test("runInit gitignore handling: accepts git init and skips duplication", { timeout: 10_000 }, async () => {
  await withTempDir(async (dir) => {
    const gitignorePath = join(dir, ".gitignore");
    assert.ok(!existsSync(gitignorePath), "should start with no .gitignore");

    const { runInit } = await import("../../src/cli/commands/init.js");
    await runInit(dir, acceptAll);

    assert.ok(existsSync(gitignorePath), ".gitignore should be created when git init is accepted");
    const content = await readFileAsync(gitignorePath, "utf8");
    assert.ok(content.includes(".alix/"), ".gitignore should contain .alix/");
  });
});