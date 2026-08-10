import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { persistModelSelection, resolveTierArg } from "../../src/cli/commands/models.js";

async function withProjectConfig(initial: Record<string, unknown>) {
  const dir = await mkdtemp(join(tmpdir(), "alix-models-"));
  await mkdir(join(dir, ".git"), { recursive: true }); // force the project-config write path
  await mkdir(join(dir, ".alix"), { recursive: true });
  const configPath = join(dir, ".alix", "config.json");
  await writeFile(configPath, JSON.stringify(initial));
  return {
    dir,
    configPath,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

describe("resolveTierArg (§8.2 canonical non-default vocabulary)", () => {
  it("accepts the six canonical subagent tiers", () => {
    for (const t of ["thinking", "coding", "fast", "critic", "tiny", "image"]) {
      expect(resolveTierArg(t)).toBe(t);
    }
  });
  it("rejects profile vocabulary and arbitrary strings", () => {
    expect(resolveTierArg("coder")).toBeUndefined();
    expect(resolveTierArg("planner")).toBeUndefined();
    expect(resolveTierArg("researcher")).toBeUndefined();
    expect(resolveTierArg("bogus")).toBeUndefined();
    expect(resolveTierArg("")).toBeUndefined();
    expect(resolveTierArg(undefined)).toBeUndefined();
  });
  it("rejects default — it is owned by set-default", () => {
    expect(resolveTierArg("default")).toBeUndefined();
  });
});

describe("persistModelSelection (§8.1/§8.3/§8.5)", () => {
  it("set-default writes models.default and strips legacy projections", async () => {
    const { dir, configPath, cleanup } = await withProjectConfig({
      model: { provider: "old", name: "old" },
    });
    try {
      const path = await persistModelSelection(dir, "default", { provider: "openai", name: "gpt-4o" });
      expect(path).toBe(configPath);
      const saved = JSON.parse(await readFile(configPath, "utf8"));
      expect(saved.models.default).toEqual({ provider: "openai", name: "gpt-4o" });
      expect(saved.model).toBeUndefined();
      expect(saved.subagents).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it("set-tier merges and never erases unrelated tiers (§8.3)", async () => {
    const { dir, configPath, cleanup } = await withProjectConfig({
      models: {
        default: { provider: "openai", name: "gpt-4o" },
        fast: { provider: "openai", name: "gpt-4o-mini" },
      },
    });
    try {
      await persistModelSelection(dir, "coding", { provider: "anthropic", name: "claude-3-5-sonnet" });
      const saved = JSON.parse(await readFile(configPath, "utf8"));
      expect(saved.models.coding).toEqual({ provider: "anthropic", name: "claude-3-5-sonnet" });
      expect(saved.models.default).toEqual({ provider: "openai", name: "gpt-4o" }); // survives
      expect(saved.models.fast).toEqual({ provider: "openai", name: "gpt-4o-mini" }); // survives
      expect(saved.model).toBeUndefined();
      expect(saved.subagents).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it("strips legacy model/subagents from an existing config (§8.5 disk shape)", async () => {
    const { dir, configPath, cleanup } = await withProjectConfig({
      model: { provider: "old", name: "old" },
      subagents: { coding: { provider: "old", name: "old" } },
    });
    try {
      await persistModelSelection(dir, "default", { provider: "openai", name: "gpt-4o" });
      const saved = JSON.parse(await readFile(configPath, "utf8"));
      expect(saved.model).toBeUndefined();
      expect(saved.subagents).toBeUndefined();
      expect(saved.models.default).toEqual({ provider: "openai", name: "gpt-4o" });
    } finally {
      await cleanup();
    }
  });
});
