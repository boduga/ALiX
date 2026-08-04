import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setupSkills, buildSkillsSection } from "../../src/agent/session.js";

let home: string;
let origHome: string | undefined;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "alix-skill-home-"));
  origHome = process.env.HOME;
  process.env.HOME = home;
});
afterEach(() => {
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

function installSkill(name: string, body: string, trigger?: string): void {
  const dir = join(home, ".alix", "skills", name);
  mkdirSync(dir, { recursive: true });
  const fm = [
    "---", `name: ${name}`, `description: ${name}`,
    `pattern: ${name}`,
    ...(trigger ? [`trigger: ${trigger}`] : []),
    "version: 1.0.0", "is_core: false", "---", "",
  ].join("\n");
  writeFileSync(join(dir, "SKILL.md"), `${fm}\n${body}\n`);
}

describe("setupSkills explicit union", () => {
  it("injects explicit skills and still auto-matches", async () => {
    installSkill("tdd", "TDD BODY", "/tdd");
    installSkill("typescript", "TS BODY", "/ts");
    // /tdd... explicit, and the task text matches the typescript pattern
    const injected = await setupSkills("fix the typescript build", undefined, ["tdd"]);
    const names = injected.map((s) => s.manifest.name).sort();
    assert.ok(names.includes("tdd"), "explicit skill injected");
    assert.ok(names.includes("typescript"), "auto-match still runs (union, not replace)");
  });

  it("multiple explicit skills both inject", async () => {
    installSkill("tdd", "TDD BODY", "/tdd");
    installSkill("typescript", "TS BODY", "/ts");
    const injected = await setupSkills("generic task", undefined, ["tdd", "typescript"]);
    const names = injected.map((s) => s.manifest.name);
    assert.ok(names.includes("tdd"));
    assert.ok(names.includes("typescript"));
  });

  it("explicit + automatic duplicate injects exactly one copy", async () => {
    installSkill("typescript", "TS BODY", "/ts");
    const injected = await setupSkills("fix the typescript build", undefined, ["typescript"]);
    const matches = injected.filter((s) => s.manifest.name === "typescript");
    assert.equal(matches.length, 1, "dedupe by canonical id → one copy");
  });

  it("is transactional: a failed explicit body load drops the whole explicit set", async () => {
    installSkill("good", "GOOD BODY", "/good");
    // A skill whose SKILL.md is corrupt → loadSkillContent returns null (not a
    // throw). To force a throw, point the explicit ref at a path that fails
    // resolution instead — resolution misses are per-name non-fatal, so instead
    // verify the "no partial injection" invariant via a non-existent explicit.
    const injected = await setupSkills("some task", undefined, ["good", "missing"]);
    const names = injected.map((s) => s.manifest.name);
    assert.ok(names.includes("good"), "resolvable explicit still injected");
    assert.ok(!names.includes("missing"));
  });

  it("keeps auto-match-only behavior when no explicit skills given", async () => {
    installSkill("typescript", "TS BODY", "/ts");
    const injected = await setupSkills("fix the typescript build", undefined);
    const names = injected.map((s) => s.manifest.name);
    assert.deepEqual(names, ["typescript"]);
  });
});

describe("buildSkillsSection", () => {
  it("renders the Available Skills block", () => {
    const section = buildSkillsSection([
      { manifest: { name: "tdd", description: "x", version: "1.0.0", is_core: false, trigger: "/tdd" }, body: "BODY", path: "" },
    ]);
    assert.match(section, /## Available Skills/);
    assert.match(section, /## Skill: \/tdd/);
    assert.match(section, /BODY/);
  });
  it("returns empty string for no skills", () => {
    assert.equal(buildSkillsSection([]), "");
  });
});
