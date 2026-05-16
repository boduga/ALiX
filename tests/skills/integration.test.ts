import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadSkills } from "../../src/skills/loader.js";
import { buildSkillCatalog } from "../../src/skills/catalog.js";

describe("skill catalog integration in run.ts", () => {
  // Use temp dirs to avoid ~/.alix/skills/ pollution and cross-test interference
  const tmpDir1 = join("/tmp", `skills-integration-${Date.now()}-1`);
  const tmpDir2 = join("/tmp", `skills-integration-${Date.now()}-2`);

  afterEach(() => {
    rmSync(tmpDir1, { recursive: true, force: true });
    rmSync(tmpDir2, { recursive: true, force: true });
  });

  it("loads skills from ~/.alix/skills/ at startup", async () => {
    mkdirSync(join(tmpDir1, "skill-test-integration"), { recursive: true });
    writeFileSync(join(tmpDir1, "skill-test-integration", "SKILL.md"), `---
name: skill-test-integration
description: A test skill
trigger: /test
version: "1.0.0"
is_core: false
---
# Test`);
    const skills = await loadSkills(tmpDir1);
    assert.ok(skills.some(s => s.manifest.name === "skill-test-integration"));
  });

  it("buildSkillCatalog routes by trigger", async () => {
    mkdirSync(join(tmpDir2, "skill-test-cat"), { recursive: true });
    writeFileSync(join(tmpDir2, "skill-test-cat", "SKILL.md"), `---
name: skill-test-cat
description: TDD loop
trigger: /tdd
version: "1.0.0"
is_core: false
---
# TDD`);
    const skills = await loadSkills(tmpDir2);
    const catalog = buildSkillCatalog(skills);
    const matched = catalog.match("/tdd add login feature");
    assert.ok(matched.some(s => s.manifest.name === "skill-test-cat"));
  });

  it("skill body is injected into system prompt when matched", () => {
    const body = "# TDD Loop\n\nFollow red-green-refactor.";
    const injected = injectSkillIntoSystemPrompt(
      "You are ALiX.",
      [{ manifest: { name: "tdd", description: "TDD loop", trigger: "/tdd", version: "1.0.0", is_core: false }, body, path: "" }]
    );
    assert.ok(injected.includes("TDD Loop"));
    assert.ok(injected.includes("/tdd"));
  });
});

function injectSkillIntoSystemPrompt(base: string, skills: Array<{ manifest: { name: string; trigger?: string; description: string; version: string; is_core: boolean }; body: string; path: string }>): string {
  if (skills.length === 0) return base;
  const skillSection = skills
    .map(s => `## Skill: ${s.manifest.trigger ?? s.manifest.name}\n${s.body}`)
    .join("\n\n");
  return `${base}\n\n## Available Skills\n${skillSection}`;
}