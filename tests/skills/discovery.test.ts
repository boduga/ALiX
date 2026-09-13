import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  getAlixSkillsDir,
  getAgentsSkillsDir,
  getProjectSkillsDir,
  getSkillDiscoveryRoots,
  loadSkillManifestsFromRoots,
  resolveDiscoveredSkillDir,
} from "../../src/skills/discovery.js";

function writeSkill(root: string, dir: string, name: string, extra = ""): void {
  mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, dir, "SKILL.md"), `---
name: ${name}
description: ${name} description
${extra}---
# ${name}`);
}

describe("skill discovery roots", () => {
  it("orders the ALiX store before the shared agents dir", () => {
    const roots = getSkillDiscoveryRoots("/home/testuser");
    assert.deepStrictEqual(roots, [
      join("/home/testuser", ".alix", "skills"),
      join("/home/testuser", ".agents", "skills"),
    ]);
    assert.strictEqual(getAlixSkillsDir("/home/testuser"), roots[0]);
    assert.strictEqual(getAgentsSkillsDir("/home/testuser"), roots[1]);
  });

  it("prepends the project store first when a project dir is given", () => {
    const roots = getSkillDiscoveryRoots("/home/testuser", "/home/testuser/proj");
    assert.deepStrictEqual(roots, [
      join("/home/testuser", "proj", ".alix", "skills"),
      join("/home/testuser", ".alix", "skills"),
      join("/home/testuser", ".agents", "skills"),
    ]);
    assert.strictEqual(getProjectSkillsDir("/home/testuser/proj"), roots[0]);
  });
});

describe("loadSkillManifestsFromRoots", () => {
  const tmpBase = join("/tmp", `skills-discovery-test-${Date.now()}`);
  const alixRoot = join(tmpBase, "alix-skills");
  const agentsRoot = join(tmpBase, "agents-skills");
  beforeEach(() => {
    mkdirSync(alixRoot, { recursive: true });
    mkdirSync(agentsRoot, { recursive: true });
  });
  afterEach(() => { try { rmSync(tmpBase, { recursive: true }); } catch {} });

  it("unions manifests across both roots", async () => {
    writeSkill(alixRoot, "alix-only", "alix-only");
    writeSkill(agentsRoot, "agents-only", "agents-only");
    const manifests = await loadSkillManifestsFromRoots([alixRoot, agentsRoot]);
    assert.deepStrictEqual(manifests.map((m) => m.manifest.name).sort(), ["agents-only", "alix-only"]);
  });

  it("lets the first root win on manifest.name collision", async () => {
    writeSkill(alixRoot, "shared", "shared");
    writeSkill(agentsRoot, "shared", "shared");
    const manifests = await loadSkillManifestsFromRoots([alixRoot, agentsRoot]);
    assert.strictEqual(manifests.length, 1);
    assert.strictEqual(manifests[0].path, join(alixRoot, "shared"));
  });

  it("tolerates a missing root", async () => {
    writeSkill(alixRoot, "alix-only", "alix-only");
    const manifests = await loadSkillManifestsFromRoots([alixRoot, join(tmpBase, "does-not-exist")]);
    assert.strictEqual(manifests.length, 1);
    const empty = await loadSkillManifestsFromRoots([join(tmpBase, "does-not-exist")]);
    assert.strictEqual(empty.length, 0);
  });

  it("skips entries without a valid manifest in either root", async () => {
    writeFileSync(join(alixRoot, "README.md"), "# not a skill");
    mkdirSync(join(agentsRoot, "bad-skill"), { recursive: true });
    writeFileSync(join(agentsRoot, "bad-skill", "SKILL.md"), "# No front matter");
    const manifests = await loadSkillManifestsFromRoots([alixRoot, agentsRoot]);
    assert.strictEqual(manifests.length, 0);
  });
});

describe("resolveDiscoveredSkillDir", () => {
  const fakeHome = join("/tmp", `skills-resolve-test-${Date.now()}`);
  const alixRoot = join(fakeHome, ".alix", "skills");
  const agentsRoot = join(fakeHome, ".agents", "skills");
  const projRoot = join(fakeHome, "proj", ".alix", "skills");
  beforeEach(() => {
    mkdirSync(alixRoot, { recursive: true });
    mkdirSync(agentsRoot, { recursive: true });
    mkdirSync(projRoot, { recursive: true });
  });
  afterEach(() => { try { rmSync(fakeHome, { recursive: true }); } catch {} });

  it("prefers the ALiX store and falls back to the agents dir", () => {
    writeSkill(alixRoot, "both", "both");
    writeSkill(agentsRoot, "both", "both");
    writeSkill(agentsRoot, "agents-only", "agents-only");
    assert.strictEqual(resolveDiscoveredSkillDir("both", fakeHome), join(alixRoot, "both"));
    assert.strictEqual(resolveDiscoveredSkillDir("agents-only", fakeHome), join(agentsRoot, "agents-only"));
  });

  it("prefers the project store over every other root", () => {
    writeSkill(projRoot, "both", "both");
    writeSkill(alixRoot, "both", "both");
    writeSkill(agentsRoot, "proj-only", "proj-only");
    assert.strictEqual(
      resolveDiscoveredSkillDir("both", fakeHome, join(fakeHome, "proj")),
      join(projRoot, "both"),
    );
    assert.strictEqual(
      resolveDiscoveredSkillDir("proj-only", fakeHome, join(fakeHome, "proj")),
      join(agentsRoot, "proj-only"),
    );
  });

  it("returns null when the skill is in neither root", () => {
    assert.strictEqual(resolveDiscoveredSkillDir(`missing-${Date.now()}`, fakeHome), null);
  });
});
