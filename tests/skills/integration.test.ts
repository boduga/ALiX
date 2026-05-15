import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadSkills } from "../../src/skills/loader.js";
import { buildSkillCatalog } from "../../src/skills/catalog.js";

describe("skill catalog integration in run.ts", () => {
  const home = process.env.HOME ?? "/home/babasola";
  const skillsDir = join(home, ".alix", "skills");

  it("loads skills from ~/.alix/skills/ at startup", async () => {
    mkdirSync(skillsDir, { recursive: true });
    mkdirSync(join(skillsDir, "test-skill"), { recursive: true });
    writeFileSync(join(skillsDir, "test-skill", "SKILL.md"), `---
name: test-skill
description: A test skill
trigger: /test
version: "1.0.0"
is_core: false
---
# Test`);
    const skills = await loadSkills(skillsDir);
    assert.ok(skills.some(s => s.manifest.name === "test-skill"));
    rmSync(join(skillsDir, "test-skill"), { recursive: true });
  });

  it("buildSkillCatalog routes by trigger", async () => {
    mkdirSync(skillsDir, { recursive: true });
    mkdirSync(join(skillsDir, "tdd"), { recursive: true });
    writeFileSync(join(skillsDir, "tdd", "SKILL.md"), `---
name: tdd
description: TDD loop
trigger: /tdd
version: "1.0.0"
is_core: false
---
# TDD`);
    const skills = await loadSkills(skillsDir);
    const catalog = buildSkillCatalog(skills);
    const matched = catalog.match("/tdd add login feature");
    assert.ok(matched.some(s => s.manifest.name === "tdd"));
    rmSync(join(skillsDir, "tdd"), { recursive: true });
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