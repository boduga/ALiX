import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadSkills, loadSkillManifests, loadSkillContent } from "../../src/skills/loader.js";
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

describe("loadSkillManifests", () => {
  const tmpDir = join("/tmp", `manifests-test-${Date.now()}`);
  beforeEach(() => mkdirSync(join(tmpDir, "test-skill"), { recursive: true }));
  afterEach(() => { try { rmSync(tmpDir, { recursive: true }); } catch {} });

  it("loads only manifests without body content", async () => {
    writeFileSync(join(tmpDir, "test-skill", "SKILL.md"), `---
name: test-skill
description: A test skill for loading
trigger: /test
version: "1.0.0"
is_core: false
---
# Test Skill Body Content

This is the body that should NOT be loaded at startup.`);
    const manifests = await loadSkillManifests(tmpDir);
    assert.strictEqual(manifests.length, 1);
    assert.strictEqual(manifests[0].manifest.name, "test-skill");
    assert.strictEqual(manifests[0].manifest.trigger, "/test");
    assert.ok(!(manifests[0] as any).body, "body should not be present in manifest-only load");
  });

  it("returns empty array for empty directory", async () => {
    const emptyDir = join("/tmp", `empty-manifests-${Date.now()}`);
    mkdirSync(emptyDir, { recursive: true });
    const manifests = await loadSkillManifests(emptyDir);
    assert.strictEqual(manifests.length, 0);
    rmSync(emptyDir, { recursive: true });
  });
});

describe("loadSkillContent", () => {
  const tmpDir = join("/tmp", `skill-content-test-${Date.now()}`);
  beforeEach(() => mkdirSync(join(tmpDir, "test-skill"), { recursive: true }));
  afterEach(() => { try { rmSync(tmpDir, { recursive: true }); } catch {} });

  it("loads full content (manifest + body) for a specific path", async () => {
    const skillPath = join(tmpDir, "test-skill");
    writeFileSync(join(skillPath, "SKILL.md"), `---
name: test-skill
description: A test skill
trigger: /test
version: "1.0.0"
is_core: false
---
# Test Skill

This is the body content.`);
    const content = await loadSkillContent(skillPath);
    assert.ok(content, "content should not be null");
    assert.strictEqual(content!.manifest.name, "test-skill");
    assert.ok(content!.body.includes("Test Skill"), "body should contain the body content");
  });

  it("returns null for non-existent path", async () => {
    const content = await loadSkillContent("/non/existent/path");
    assert.strictEqual(content, null);
  });
});

describe("SkillCatalog.getMatchedContent", () => {
  it("only loads content for matched skills", async () => {
    const tmpDir = join("/tmp", `lazy-load-test-${Date.now()}`);
    mkdirSync(join(tmpDir, "matched-skill"), { recursive: true });
    mkdirSync(join(tmpDir, "unmatched-skill"), { recursive: true });

    writeFileSync(join(tmpDir, "matched-skill", "SKILL.md"), `---
name: matched-skill
description: A skill that matches
trigger: /matched
version: "1.0.0"
is_core: false
---
# Matched Skill Body

This body should be loaded because the skill matches.`);
    writeFileSync(join(tmpDir, "unmatched-skill", "SKILL.md"), `---
name: unmatched-skill
description: A skill that does not match
trigger: /notmatched
version: "1.0.0"
is_core: false
---
# Unmatched Skill Body

This body should NOT be loaded because the skill doesn't match.`);

    const manifests = await loadSkillManifests(tmpDir);
    const catalog = buildSkillCatalog(manifests);

    // Only /matched should return content
    const matchedContent = await catalog.getMatchedContent("/matched test");
    assert.strictEqual(matchedContent.length, 1);
    assert.strictEqual(matchedContent[0].manifest.name, "matched-skill");
    assert.ok(matchedContent[0].body.includes("Matched Skill Body"));

    rmSync(tmpDir, { recursive: true });
  });

  it("returns empty array when no skills match", async () => {
    const tmpDir = join("/tmp", `no-match-test-${Date.now()}`);
    mkdirSync(join(tmpDir, "some-skill"), { recursive: true });
    writeFileSync(join(tmpDir, "some-skill", "SKILL.md"), `---
name: some-skill
description: A skill
trigger: /some
version: "1.0.0"
is_core: false
---
# Some Skill`);

    const manifests = await loadSkillManifests(tmpDir);
    const catalog = buildSkillCatalog(manifests);
    const matchedContent = await catalog.getMatchedContent("no match prompt");
    assert.strictEqual(matchedContent.length, 0);

    rmSync(tmpDir, { recursive: true });
  });
});
