import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadSkills } from "../../src/skills/loader.js";
import { SkillCatalog, buildSkillCatalog } from "../../src/skills/catalog.js";

describe("loadSkills", () => {
  const tmpDir = join("/tmp", `skills-loader-test-${Date.now()}`);
  beforeEach(() => mkdirSync(join(tmpDir, "test-skill"), { recursive: true }));
  afterEach(() => { try { rmSync(tmpDir, { recursive: true }); } catch {} });

  it("loads a valid Hermes-format skill", async () => {
    writeFileSync(join(tmpDir, "test-skill", "SKILL.md"), `---
name: test-skill
description: A test skill for loading
trigger: /test
version: "1.0.0"
is_core: false
---
# Test Skill

Use this skill for testing.`);
    const skills = await loadSkills(tmpDir);
    assert.strictEqual(skills.length, 1);
    assert.strictEqual(skills[0].manifest.name, "test-skill");
    assert.strictEqual(skills[0].manifest.trigger, "/test");
    assert.ok(skills[0].body.includes("Test Skill"));
  });

  it("skips files without SKILL.md", async () => {
    writeFileSync(join(tmpDir, "test-skill", "README.md"), "# Readme");
    const skills = await loadSkills(tmpDir);
    assert.strictEqual(skills.length, 0);
  });

  it("skips skills with missing front matter fields", async () => {
    mkdirSync(join(tmpDir, "bad-skill"), { recursive: true });
    writeFileSync(join(tmpDir, "bad-skill", "SKILL.md"), "# No front matter");
    const skills = await loadSkills(tmpDir);
    assert.strictEqual(skills.length, 0);
  });

  it("loads multiple skills from subdirectories", async () => {
    mkdirSync(join(tmpDir, "skill-a"), { recursive: true });
    mkdirSync(join(tmpDir, "skill-b"), { recursive: true });
    writeFileSync(join(tmpDir, "skill-a", "SKILL.md"), `---
name: skill-a
description: First skill
trigger: /a
version: "1.0.0"
is_core: false
---
# Skill A`);
    writeFileSync(join(tmpDir, "skill-b", "SKILL.md"), `---
name: skill-b
description: Second skill
trigger: /b
version: "1.0.0"
is_core: false
---
# Skill B`);
    const skills = await loadSkills(tmpDir);
    assert.strictEqual(skills.length, 2);
  });
});

describe("SkillCatalog", () => {
  it("routes by trigger (slash command)", async () => {
    const tmpDir = join("/tmp", `catalog-test-trigger-${Date.now()}`);
    mkdirSync(join(tmpDir, "skill-one"), { recursive: true });
    writeFileSync(join(tmpDir, "skill-one", "SKILL.md"), `---
name: skill-one
description: A skill with a trigger
trigger: /deploy
version: "1.0.0"
is_core: false
---
# Deploy Skill`);
    const skills = await loadSkills(tmpDir);
    const catalog = buildSkillCatalog(skills);
    const matched = catalog.match("/deploy something");
    assert.ok(matched.length > 0);
    assert.strictEqual(matched[0].manifest.name, "skill-one");
    rmSync(tmpDir, { recursive: true });
  });

  it("routes by pattern (regex)", async () => {
    const tmpDir = join("/tmp", `catalog-test-pattern-${Date.now()}`);
    mkdirSync(join(tmpDir, "skill-one"), { recursive: true });
    writeFileSync(join(tmpDir, "skill-one", "SKILL.md"), `---
name: skill-one
description: A skill with a pattern
pattern: "fix.*bug|bugfix"
version: "1.0.0"
is_core: false
---
# Bugfix Skill`);
    const skills = await loadSkills(tmpDir);
    const catalog = buildSkillCatalog(skills);
    const matched = catalog.match("fix the bug in user.ts");
    assert.ok(matched.length > 0);
    assert.strictEqual(matched[0].manifest.name, "skill-one");
    rmSync(tmpDir, { recursive: true });
  });

  it("returns empty for no match", () => {
    const catalog = buildSkillCatalog([]);
    const matched = catalog.match("random text");
    assert.strictEqual(matched.length, 0);
  });
});
