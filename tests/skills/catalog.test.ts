import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SkillCatalog, type SkillEntry } from "../../src/skills/catalog.js";

function entry(name: string, trigger?: string): SkillEntry {
  return {
    manifest: { name, description: name, version: "1.0.0", is_core: false, trigger },
    path: `/skills/${name}`,
  };
}

describe("SkillCatalog.getByTriggerOrName", () => {
  const catalog = new SkillCatalog([
    entry("typescript", "/ts"),
    entry("tdd"),
  ]);
  it("looks up by trigger (with slash)", () => {
    assert.equal(catalog.getByTriggerOrName("/ts")?.manifest.name, "typescript");
  });
  it("looks up by trigger (without slash)", () => {
    assert.equal(catalog.getByTriggerOrName("ts")?.manifest.name, "typescript");
  });
  it("looks up by name", () => {
    assert.equal(catalog.getByTriggerOrName("tdd")?.manifest.name, "tdd");
  });
  it("returns undefined for unknown", () => {
    assert.equal(catalog.getByTriggerOrName("/nope"), undefined);
  });
});
