import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { SkillManifest } from "../../src/skills/types.js";
import {
  getSlashCatalog, invalidateSlashCatalog, setSlashCatalogLoaderForTest,
  setSlashCatalogProjectDir,
} from "../../src/skills/slash-catalog.js";

function m(name: string): SkillManifest {
  return { name, description: name, version: "1.0.0", is_core: false };
}

describe("slash-catalog generation cache", () => {
  it("builds once and caches across reads", async () => {
    let calls = 0;
    setSlashCatalogLoaderForTest(async () => { calls++; return [m("a")]; });
    try {
      const first = await getSlashCatalog();
      const second = await getSlashCatalog();
      assert.equal(calls, 1, "loader called exactly once");
      assert.equal(first.length, 1);
      assert.equal(second, first, "same cached array instance");
    } finally {
      setSlashCatalogLoaderForTest(null);
    }
  });

  it("invalidateSlashCatalog forces a rebuild on next read", async () => {
    let calls = 0;
    setSlashCatalogLoaderForTest(async () => { calls++; return [m(`v${calls}`)]; });
    try {
      const a = await getSlashCatalog();
      invalidateSlashCatalog();
      const b = await getSlashCatalog();
      assert.equal(calls, 2);
      assert.notEqual(a, b);
      assert.equal(b[0].name, "v2");
    } finally {
      setSlashCatalogLoaderForTest(null);
    }
  });

  it("detects a stale build started before invalidation and rebuilds", async () => {    let resolveSlow: (v: SkillManifest[]) => void = () => {};
    let calls = 0;
    setSlashCatalogLoaderForTest(() => {
      calls++;
      if (calls === 1) return new Promise<SkillManifest[]>((res) => { resolveSlow = res; });
      return Promise.resolve([m("fresh")]);
    });
    try {
      const slowBuild = getSlashCatalog();
      invalidateSlashCatalog();           // generation bumps while build is in flight
      resolveSlow([m("stale")]);          // build resolves AFTER invalidation
      const fresh = await slowBuild;
      assert.equal(calls, 2, "stale build discarded; reload happened");
      assert.equal(fresh[0].name, "fresh");
    } finally {
      setSlashCatalogLoaderForTest(null);
    }
  });
});

describe("slash-catalog project scope", () => {
  it("includes project-local skills once a project dir is set", async () => {
    const proj = join("/tmp", `slash-catalog-proj-${Date.now()}`);
    const skillDir = join(proj, ".alix", "skills", "proj-only");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: proj-only\ndescription: P\n---\nBody");
    setSlashCatalogLoaderForTest(null); // default loader (real discovery)
    setSlashCatalogProjectDir(proj);
    try {
      const manifests = await getSlashCatalog();
      assert.ok(manifests.some((s) => s.name === "proj-only"), "project skill should be listed");
    } finally {
      setSlashCatalogProjectDir(null);
      rmSync(proj, { recursive: true, force: true });
    }
  });

  it("setting the same project dir twice does not rebuild", async () => {
    let calls = 0;
    setSlashCatalogLoaderForTest(async () => { calls++; return [m("a")]; });
    setSlashCatalogProjectDir(null);
    try {
      await getSlashCatalog();
      setSlashCatalogProjectDir(null); // no change → no invalidation
      await getSlashCatalog();
      assert.equal(calls, 1, "unchanged project dir must not invalidate the cache");
    } finally {
      setSlashCatalogLoaderForTest(null);
    }
  });
});
