import { describe, it, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert";
import { mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, existsSync, unlinkSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate from the operator's real ~/.alix/skills: promotion.ts resolves
// HOME at import time and these tests create + wipe skill dirs, so HOME must
// point at a temp dir BEFORE any src/skills module is (dynamically) imported
// below. Fail-closed: if mkdtemp throws, the file fails at load and no test
// runs against the real home.
const testHome = mkdtempSync(join(tmpdir(), "alix-skills-test-"));
process.env.HOME = testHome;

after(() => {
  try { rmSync(testHome, { recursive: true, force: true }); } catch {}
});

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
    // Clear all skills created by this test
    try {
      const entries = readdirSync(skillsDir);
      for (const entry of entries) {
        if (entry !== ".usage.json" && entry !== "node_modules") {
          rmSync(join(skillsDir, entry), { recursive: true });
        }
      }
    } catch {}
    // Clean up candidates test dir
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

  it("blocks promotion of a candidate colliding with an installed skill", async () => {
    const { promoteIfEligible } = await import("../../src/skills/promotion.js");
    mkdirSync(join(skillsDir, "loop-guardian"), { recursive: true });
    writeFileSync(join(skillsDir, "loop-guardian", "SKILL.md"), `---
name: loop-guardian
description: Stop infinite execution loops
trigger: /prevent-loops
version: "1.0.0"
is_core: false
---
# Loop Guardian`);
    const blockSessionId = `block-test-${Date.now()}`;
    const blockCandidateDir = join(candidatesDir, blockSessionId);
    try {
      mkdirSync(blockCandidateDir, { recursive: true });
      writeFileSync(join(blockCandidateDir, "SKILL.md"), `---
name: loop-helper
description: Detect and break out of infinite iteration loops
trigger: /prevent-loops
version: "1.0.0"
is_core: false
---
# Loop Helper`);
      await promoteIfEligible(blockSessionId);
      const result = await promoteIfEligible(blockSessionId);
      assert.strictEqual(result.promoted, false);
      assert.ok(result.blocked?.includes("loop-guardian"), "blocked reason names the colliding skill");
      assert.ok(!existsSync(join(skillsDir, "loop-helper")), "colliding candidate must not be installed");
    } finally {
      try { rmSync(blockCandidateDir, { recursive: true }); } catch {}
    }
  });

  it("blocks a same-name candidate with a duplicate body", async () => {
    const { promoteIfEligible } = await import("../../src/skills/promotion.js");
    mkdirSync(join(skillsDir, "dup-skill"), { recursive: true });
    writeFileSync(join(skillsDir, "dup-skill", "SKILL.md"), `---
name: dup-skill
description: A duplicated skill
trigger: /dup
version: "1.0.0"
is_core: false
---
# Dup Skill

Same body content here.`);
    const dupSessionId = `dup-test-${Date.now()}`;
    const dupCandidateDir = join(candidatesDir, dupSessionId);
    try {
      mkdirSync(dupCandidateDir, { recursive: true });
      writeFileSync(join(dupCandidateDir, "SKILL.md"), `---
name: dup-skill
description: A duplicated skill
trigger: /dup
version: "1.0.0"
is_core: false
---
# Dup Skill

Same body content here.`);
      await promoteIfEligible(dupSessionId);
      const result = await promoteIfEligible(dupSessionId);
      assert.strictEqual(result.promoted, false);
      assert.ok(result.blocked?.includes("duplicates"), "blocked reason mentions duplication");
      assert.ok(!existsSync(join(skillsDir, "dup-skill-v1-0-0")), "no version-suffixed dupe");
    } finally {
      try { rmSync(dupCandidateDir, { recursive: true }); } catch {}
    }
  });

  it("versions a same-name candidate with a revised body", async () => {
    const { promoteIfEligible } = await import("../../src/skills/promotion.js");
    mkdirSync(join(skillsDir, "rev-skill"), { recursive: true });
    writeFileSync(join(skillsDir, "rev-skill", "SKILL.md"), `---
name: rev-skill
description: Original skill
trigger: /rev
version: "1.0.0"
is_core: false
---
# Rev Skill

Original approach with execution budgets and milestone checkpoints.`);
    const revSessionId = `rev-test-${Date.now()}`;
    const revCandidateDir = join(candidatesDir, revSessionId);
    try {
      mkdirSync(revCandidateDir, { recursive: true });
      writeFileSync(join(revCandidateDir, "SKILL.md"), `---
name: rev-skill
description: Revised skill
trigger: /rev
version: "1.0.0"
is_core: false
---
# Rev Skill

Completely rewritten circuit breaker protocol with state summaries and forced strategy pivots.`);
      await promoteIfEligible(revSessionId);
      const result = await promoteIfEligible(revSessionId);
      assert.strictEqual(result.promoted, true);
      assert.strictEqual(result.blocked, undefined);
    } finally {
      try { rmSync(revCandidateDir, { recursive: true }); } catch {}
    }
  });
});

describe("LRU eviction", () => {
  const home = process.env.HOME ?? "/home/babasola";
  const skillsDir = join(home, ".alix", "skills");
  const testSessionId = `lru-test-${Date.now()}`;

  beforeEach(() => {
    mkdirSync(skillsDir, { recursive: true });
    // Clear .usage.json for clean tests
    const usagePath = join(skillsDir, ".usage.json");
    try { unlinkSync(usagePath); } catch {}
    // Clear ALL existing skills to ensure clean state between tests
    try {
      const entries = readdirSync(skillsDir);
      for (const entry of entries) {
        if (entry !== ".usage.json" && entry !== "node_modules") {
          rmSync(join(skillsDir, entry), { recursive: true });
        }
      }
    } catch {}
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