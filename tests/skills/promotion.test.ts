import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

describe("promotion lifecycle", () => {
  const home = process.env.HOME ?? "/home/babasola";
  const candidatesDir = join(home, ".alix", "candidates");
  const skillsDir = join(home, ".alix", "skills");
  const testSessionId = `test-${Date.now()}`;
  const testCandidateDir = join(candidatesDir, testSessionId);

  beforeEach(() => {
    mkdirSync(candidatesDir, { recursive: true });
    mkdirSync(skillsDir, { recursive: true });
    mkdirSync(testCandidateDir, { recursive: true });
    writeFileSync(join(testCandidateDir, "SKILL.md"), `---
name: tdd-loop
description: Red-green-refactor TDD loop
trigger: /tdd
version: "1.0.0"
is_core: false
---
# TDD Loop

Follow red-green-refactor.`);
    // Clear usage.json for clean tests
    const usagePath = join(skillsDir, ".usage.json");
    try { unlinkSync(usagePath); } catch {}
  });
  afterEach(() => {
    try { rmSync(join(candidatesDir, testSessionId), { recursive: true }); } catch {}
  });

  it("does not promote on first use", async () => {
    const { promoteIfEligible } = await import("../../src/skills/promotion.js");
    await promoteIfEligible(testSessionId);
    const skillPath = join(skillsDir, "tdd-loop", "SKILL.md");
    assert.ok(!existsSync(skillPath), "Should not promote on first use");
  });

  it("promotes candidate to skills/ on second successful use", async () => {
    const { promoteIfEligible } = await import("../../src/skills/promotion.js");
    await promoteIfEligible(testSessionId);
    await promoteIfEligible(testSessionId);
    const skillPath = join(skillsDir, "tdd-loop", "SKILL.md");
    assert.ok(existsSync(skillPath), "Should promote on second use");
    const content = readFileSync(skillPath, "utf8");
    assert.ok(content.includes("TDD Loop"));
  });

  it("does not re-promote an already-promoted skill", async () => {
    const { promoteIfEligible } = await import("../../src/skills/promotion.js");
    await promoteIfEligible(testSessionId);
    await promoteIfEligible(testSessionId);
    await promoteIfEligible(testSessionId);
    const entries = readdirSync(skillsDir).filter(e => e === "tdd-loop");
    assert.strictEqual(entries.length, 1);
  });
});

describe("LRU eviction", () => {
  const home = process.env.HOME ?? "/home/babasola";
  const skillsDir = join(home, ".alix", "skills");

  beforeEach(() => {
    mkdirSync(skillsDir, { recursive: true });
  });

  it("evicts least recently used non-core skill when maxStore exceeded", async () => {
    const { evictIfNeeded } = await import("../../src/skills/lifecycle.js");
    const config = { maxStore: 3 };
    // Create 4 non-core skills with different mtimes
    for (let i = 0; i < 4; i++) {
      mkdirSync(join(skillsDir, `skill-${i}`), { recursive: true });
      writeFileSync(join(skillsDir, `skill-${i}`, "SKILL.md"), `---
name: skill-${i}
description: Skill ${i}
trigger: /s${i}
version: "1.0.0"
is_core: false
---
# Skill ${i}`);
    }
    await evictIfNeeded(skillsDir, config);
    // After eviction with maxStore=3, skill-0 (oldest by mtime) should be gone
    assert.ok(!existsSync(join(skillsDir, "skill-0")));
    // skill-1, skill-2, skill-3 should remain
    assert.ok(existsSync(join(skillsDir, "skill-1")));
    assert.ok(existsSync(join(skillsDir, "skill-2")));
    assert.ok(existsSync(join(skillsDir, "skill-3")));
  });

  it("protects is_core: true skills from eviction", async () => {
    const { evictIfNeeded } = await import("../../src/skills/lifecycle.js");
    const config = { maxStore: 1, maxCandidates: 10 };
    mkdirSync(join(skillsDir, "core-skill"), { recursive: true });
    writeFileSync(join(skillsDir, "core-skill", "SKILL.md"), `---
name: core-skill
description: Core skill
trigger: /core
version: "1.0.0"
is_core: true
---
# Core Skill`);
    mkdirSync(join(skillsDir, "regular-skill"), { recursive: true });
    writeFileSync(join(skillsDir, "regular-skill", "SKILL.md"), `---
name: regular-skill
description: Regular skill
trigger: /regular
version: "1.0.0"
is_core: false
---
# Regular Skill`);
    await evictIfNeeded(skillsDir, config);
    // core skill should survive, regular should be evicted
    assert.ok(!existsSync(join(skillsDir, "regular-skill")));
    assert.ok(existsSync(join(skillsDir, "core-skill")));
  });

  it("eviction handles empty or nonexistent skills dir", async () => {
    const { evictIfNeeded } = await import("../../src/skills/lifecycle.js");
    const config = { maxStore: 5, maxCandidates: 10 };
    // Should not throw when dir doesn't exist
    await evictIfNeeded("/tmp/nonexistent-dir-12345", config);
    // Should pass silently
    assert.ok(true);
  });
});