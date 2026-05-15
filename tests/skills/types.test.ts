import { describe, it } from "node:test";
import assert from "node:assert";
import { parseFrontMatter, parseSkillContent } from "../../src/skills/types.js";

describe("ALiX skill manifest", () => {
  it("parses valid YAML front matter", () => {
    const frontMatter = `---
name: tdd-loop
description: Red-green-refactor TDD cycle for feature implementation
trigger: /tdd
pattern: "tdd|test.?driven|red.?green"
version: "1.0.0"
is_core: false
---
# TDD Loop`;
    const result = parseFrontMatter(frontMatter);
    assert.strictEqual(result?.name, "tdd-loop");
    assert.strictEqual(result?.description, "Red-green-refactor TDD cycle for feature implementation");
    assert.strictEqual(result?.trigger, "/tdd");
    assert.strictEqual(result?.pattern, "tdd|test.?driven|red.?green");
    assert.strictEqual(result?.version, "1.0.0");
    assert.strictEqual(result?.is_core, false);
  });

  it("parses is_core: true", () => {
    const frontMatter = `---
name: core-skill
description: A core skill
version: "1.0.0"
is_core: true
---`;
    const result = parseFrontMatter(frontMatter);
    assert.strictEqual(result?.is_core, true);
  });

  it("rejects manifest without required fields", () => {
    const frontMatter = `---
name: test
---`;
    const result = parseFrontMatter(frontMatter);
    assert.strictEqual(result, null);
  });

  it("parses skill body after front matter", () => {
    const content = `---
name: example
description: An example skill
trigger: /example
---
# Example Skill

Follow the red-green-refactor loop.`;
    const { body } = parseSkillContent(content);
    assert.ok(body.startsWith("# Example Skill"));
    assert.ok(body.includes("red-green-refactor"));
  });
});
