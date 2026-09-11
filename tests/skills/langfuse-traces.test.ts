import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SkillCatalog } from "../../src/skills/catalog.js";
import { parseSkillContent } from "../../src/skills/types.js";

const SKILL_MD = "skills/langfuse-traces/SKILL.md";

function loadManifest() {
  const content = readFileSync(SKILL_MD, "utf8");
  const { manifest, body } = parseSkillContent(content);
  assert.ok(manifest, "SKILL.md front matter must parse");
  return { manifest: manifest!, body };
}

describe("langfuse-traces skill shape", () => {
  it("keeps the narrow agent-facing contract", () => {
    const { manifest, body } = loadManifest();
    assert.equal(manifest.name, "langfuse-traces");
    assert.equal(manifest.trigger, "/traces");
    assert.match(manifest.description, /Read-only/);
    assert.ok(manifest.pattern, "pattern required for setupSkills auto-inject");
    assert.doesNotThrow(() => new RegExp(manifest.pattern!));
    assert.match(body, /query\.mjs/);
    assert.match(body, /non-goals/i);
  });

  it("resolves by trigger and auto-matches trace-debugging prompts", async () => {
    const { manifest, body } = loadManifest();
    const catalog = new SkillCatalog([{ manifest, path: "/skills/langfuse-traces", body }]);
    assert.equal(catalog.getByTriggerOrName("/traces")?.manifest.name, "langfuse-traces");
    const matched = await catalog.getMatchedContent("can you look up that langfuse trace for the failed run?");
    assert.ok(matched.some((s) => s.manifest.name === "langfuse-traces"));
  });

  it("stays quiet on unrelated prompts", async () => {
    const { manifest, body } = loadManifest();
    const catalog = new SkillCatalog([{ manifest, path: "/skills/langfuse-traces", body }]);
    const matched = await catalog.getMatchedContent("fix the typescript build");
    assert.ok(!matched.some((s) => s.manifest.name === "langfuse-traces"));
  });
});
