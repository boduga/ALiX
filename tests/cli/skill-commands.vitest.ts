/**
 * P7.5a — Smoke tests for skill CLI commands.
 *
 * Tests the underlying infrastructure (SkillLoader, ExtensionRegistry)
 * that the skill commands depend on. Pure unit tests — no CLI execution.
 *
 * @module
 */

import { describe, it, expect } from "vitest";

describe("SkillLoader", () => {
  it("handles missing skill gracefully", async () => {
    const { SkillLoader } = await import("../../src/extensions/skill-loader.js");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "skills-"));
    const loader = new SkillLoader(dir);
    try {
      const result = await loader.load("nonexistent-skill");
      expect(result).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists empty directory gracefully", async () => {
    const { SkillLoader } = await import("../../src/extensions/skill-loader.js");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "skills-"));
    const loader = new SkillLoader(dir);
    try {
      const list = await loader.list();
      expect(Array.isArray(list)).toBe(true);
      expect(list).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ExtensionRegistry skill filtering", () => {
  it("returns empty array for skills in empty registry", async () => {
    const { ExtensionRegistry } = await import("../../src/extensions/registry.js");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "ext-"));
    const registry = new ExtensionRegistry(dir);
    try {
      const skills = registry.list({ type: "skill" });
      expect(Array.isArray(skills)).toBe(true);
      expect(skills).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Skill handler wiring", () => {
  it("cli.ts contains skill handler with list/show/install/run subcommands", () => {
    const fs = require("node:fs");
    const source = fs.readFileSync("src/cli.ts", "utf-8");
    // Verify the skill command block exists and has all 4 subcommands
    const skillStart = source.indexOf('command === "skill"');
    expect(skillStart).toBeGreaterThan(0);
    // Extract from command start to next top-level comment
    const nextSection = source.indexOf("// --- alix agent", skillStart);
    const block = source.slice(skillStart, nextSection);
    expect(block).toContain('"list"');
    expect(block).toContain('"show"');
    expect(block).toContain('"install"');
    expect(block).toContain('"run"');
    expect(block).toContain("ExtensionRegistry");
    expect(block).toContain("SkillLoader");
  });

  it("skill handler uses dirname(ext.path) not manual path construction", () => {
    const fs = require("node:fs");
    const source = fs.readFileSync("src/cli.ts", "utf-8");
    // Should use dirname(ext.path) for skill directory computation
    expect(source).toContain("dirname(ext.path)");
    // Should not construct skill directory from storePath + type prefix
    expect(source).not.toContain("pjoin(storePath, `skill-");
  });
});
