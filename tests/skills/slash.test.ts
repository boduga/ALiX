import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SkillManifest } from "../../src/skills/types.js";
import {
  parseSlashInput, skillSlashNames, rankSkillMatches,
  resolveSkillName, canonicalSkillId,
} from "../../src/skills/slash.js";

function m(partial: Partial<SkillManifest> & { name: string; description: string }): SkillManifest {
  return { version: "1.0.0", is_core: false, ...partial };
}

describe("parseSlashInput", () => {
  it("returns null for a non-slash buffer", () => {
    assert.equal(parseSlashInput("plain text"), null);
  });
  it("returns null for exactly '/'", () => {
    assert.equal(parseSlashInput("/"), null);
  });
  it("parses /name", () => {
    assert.deepEqual(parseSlashInput("/tdd"), { command: "/tdd", rest: "" });
  });
  it("parses /name rest", () => {
    assert.deepEqual(parseSlashInput("/tdd fix parser"), { command: "/tdd", rest: "fix parser" });
  });
  it("trims whitespace around rest", () => {
    assert.deepEqual(parseSlashInput("/tdd   fix parser"), { command: "/tdd", rest: "fix parser" });
  });
});

describe("skillSlashNames", () => {
  it("returns trigger + /name when trigger present", () => {
    const s = m({ name: "typescript", trigger: "/ts", description: "x" });
    assert.deepEqual(skillSlashNames(s), ["/ts", "/typescript"]);
  });
  it("returns /name only when no trigger", () => {
    const s = m({ name: "typescript", description: "x" });
    assert.deepEqual(skillSlashNames(s), ["/typescript"]);
  });
  it("dedupes when trigger === /name", () => {
    const s = m({ name: "ts", trigger: "/ts", description: "x" });
    assert.deepEqual(skillSlashNames(s), ["/ts"]);
  });
  it("normalizes a trigger missing the leading slash", () => {
    const s = m({ name: "ts", trigger: "ts", description: "x" });
    assert.deepEqual(skillSlashNames(s), ["/ts"]);
  });
});

describe("rankSkillMatches — ordering is a CONTRACT", () => {
  const exactTrigger = m({ name: "a", trigger: "/tdd", description: "exact trigger" });
  const exactName = m({ name: "tdd", description: "exact name" });
  const prefixTrigger = m({ name: "b", trigger: "/tddx", description: "prefix trigger" });
  const prefixName = m({ name: "tddx", description: "prefix name" });
  const fuzzy = m({ name: "t_d_d_extra", description: "fuzzy" });
  const all = [fuzzy, prefixName, prefixTrigger, exactName, exactTrigger];

  it("orders exact trigger > exact name > prefix trigger > prefix name > fuzzy", () => {
    const ranked = rankSkillMatches(all, "/tdd").map((s) => s.name);
    assert.deepEqual(ranked, ["a", "tdd", "b", "tddx", "t_d_d_extra"]);
  });
});

describe("resolveSkillName", () => {
  const tsByName = m({ name: "ts", description: "x" });
  const bByTrigger = m({ name: "b", trigger: "/ts", description: "x" });
  it("resolves by trigger", () => {
    assert.equal(resolveSkillName("/ts", [tsByName, bByTrigger]), "b");
  });
  it("resolves by name", () => {
    assert.equal(resolveSkillName("/ts", [bByTrigger, tsByName]), "b");
  });
  it("returns null when unknown", () => {
    assert.equal(resolveSkillName("/nope", [tsByName]), null);
  });
});

describe("canonicalSkillId", () => {
  it("is the sole dedup authority and returns name", () => {
    const s = m({ name: "tdd", description: "x" });
    assert.equal(canonicalSkillId(s), "tdd");
  });
  it("keeps distinct skills with a shared alias distinct", () => {
    const a = m({ name: "ts", description: "A" });
    const b = m({ name: "b", trigger: "/ts", description: "B" });
    assert.notEqual(canonicalSkillId(a), canonicalSkillId(b));
  });
});
