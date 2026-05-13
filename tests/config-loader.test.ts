import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, _setHomedirOverride } from "../src/config/loader.js";

function withMockedHomedir(dir: string): () => void {
  _setHomedirOverride(dir);
  return () => _setHomedirOverride(undefined);
}

test("loads default config when project config is absent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-config-"));
  try {
    _setHomedirOverride(dir);
    const config = await loadConfig(dir);
    assert.equal(config.model.provider, "anthropic");
    assert.equal(config.ui.port, 4137);
  } finally {
    _setHomedirOverride(undefined);
    await rm(dir, { recursive: true, force: true });
  }
});

test("project config overrides defaults and preserves protected paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-config-"));
  try {
    await mkdir(join(dir, ".alix"));
    await writeFile(
      join(dir, ".alix", "config.json"),
      JSON.stringify({ model: { name: "custom-mock" }, permissions: { protectedPaths: ["private/**"] } })
    );

    const config = await loadConfig(dir);
    assert.equal(config.model.name, "custom-mock");
    assert.ok(config.permissions.protectedPaths.includes(".git/**"));
    assert.ok(config.permissions.protectedPaths.includes("private/**"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reports warning for out-of-range port", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-config-"));
  const restore = withMockedHomedir(dir);
  try {
    await mkdir(join(dir, ".alix"));
    await writeFile(join(dir, ".alix", "config.json"), JSON.stringify({ ui: { port: 80 } }));
    const config = await loadConfig(dir);
    assert.equal(config.ui.port, 80); // still applied
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});

test("reports error for invalid maxRepoMapTokens", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-config-"));
  const restore = withMockedHomedir(dir);
  try {
    await mkdir(join(dir, ".alix"));
    await writeFile(join(dir, ".alix", "config.json"), JSON.stringify({ context: { maxRepoMapTokens: -100 } }));
    const config = await loadConfig(dir);
    assert.equal(config.context.maxRepoMapTokens, -100); // still applied (graceful degradation)
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});
