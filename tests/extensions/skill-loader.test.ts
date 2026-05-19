import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkillLoader } from "../../src/extensions/skill-loader.js";

describe("SkillLoader", () => {
  let tempDir: string;
  let skillsDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "skill-loader-test-"));
    skillsDir = join(tempDir, "skills");
    await mkdir(skillsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("loads a skill from a markdown file", async () => {
    await writeFile(
      join(skillsDir, "test-skill.md"),
      "# Test Skill\n\nThis is a test skill."
    );

    const loader = new SkillLoader(skillsDir);
    const skill = await loader.load("test-skill");

    assert.ok(skill !== undefined, "skill should be loaded");
    assert.strictEqual(skill.id, "test-skill");
    assert.strictEqual(skill.name, "Test Skill");
    assert.ok(skill.content.includes("This is a test skill"));
  });

  it("extracts variables from skill content", async () => {
    await writeFile(
      join(skillsDir, "greeting.md"),
      "# Greeting\n\nHello {{name}}, welcome to {{place}}!"
    );

    const loader = new SkillLoader(skillsDir);
    const skill = await loader.load("greeting");

    assert.ok(skill !== undefined);
    assert.deepStrictEqual(skill.variables, ["name", "place"]);
  });

  it("injects context into skill content", async () => {
    await writeFile(
      join(skillsDir, "greeting.md"),
      "# Greeting\n\nHello {{name}}, welcome to {{place}}!"
    );

    const loader = new SkillLoader(skillsDir);
    const skill = await loader.load("greeting", { name: "Alice", place: "Wonderland" });

    assert.ok(skill !== undefined);
    assert.ok(skill.content.includes("Hello Alice"));
    assert.ok(skill.content.includes("welcome to Wonderland"));
  });

  it("returns undefined for missing skills", async () => {
    const loader = new SkillLoader(skillsDir);
    const skill = await loader.load("non-existent");

    assert.strictEqual(skill, undefined);
  });

  it("lists available skills", async () => {
    await writeFile(join(skillsDir, "skill-one.md"), "# Skill One\n\nContent one");
    await writeFile(join(skillsDir, "skill-two.md"), "# Skill Two\n\nContent two");

    const loader = new SkillLoader(skillsDir);
    const list = await loader.list();

    assert.deepStrictEqual(list.sort(), ["skill-one", "skill-two"]);
  });

  it("uses custom variable pattern", async () => {
    await writeFile(
      join(skillsDir, "custom.md"),
      "# Custom\n\nHello @name, welcome to @place!"
    );

    const loader = new SkillLoader(skillsDir, { variablePattern: /@(\w+)/g });
    const skill = await loader.load("custom");

    assert.ok(skill !== undefined);
    assert.deepStrictEqual(skill.variables, ["name", "place"]);
  });

  it("injects context using custom variable pattern", async () => {
    await writeFile(
      join(skillsDir, "custom.md"),
      "# Custom\n\nHello @name, welcome to @place!"
    );

    const loader = new SkillLoader(skillsDir, { variablePattern: /@(\w+)/g });
    const skill = await loader.load("custom", { name: "Bob", place: "Beach" });

    assert.ok(skill !== undefined);
    assert.ok(skill.content.includes("Hello Bob"));
    assert.ok(skill.content.includes("welcome to Beach"));
  });
});