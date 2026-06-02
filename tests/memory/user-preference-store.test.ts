import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { UserPreferenceStore } from "../../src/memory/user-preference-store.js";
import { existsSync, mkdirSync, rmSync } from "fs";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("UserPreferenceStore (node:test)", () => {
  let testDir: string;
  let store: UserPreferenceStore;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "alix-ups-"));
    mkdirSync(testDir, { recursive: true });
    store = new UserPreferenceStore(testDir);
    await store.init();
  });

  afterEach(async () => {
    if (testDir && existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  it("initializes without error", async () => {
    const s = new UserPreferenceStore(testDir);
    await s.init();
  });

  it("sets and gets a preference", async () => {
    await store.set("theme", "dark");
    const result = await store.get("theme");
    assert.equal(result, "dark");
  });

  it("returns default when key does not exist", async () => {
    const result = await store.get("nonexistent", "default");
    assert.equal(result, "default");
  });

  it("returns undefined when key does not exist without default", async () => {
    const result = await store.get("nonexistent");
    assert.equal(result, undefined);
  });

  it("lists all preferences", async () => {
    await store.set("theme", "dark");
    await store.set("language", "en");
    const result = await store.list();
    assert.deepEqual(result, { theme: "dark", language: "en" });
  });

  it("deletes a preference", async () => {
    await store.set("theme", "dark");
    await store.delete("theme");
    const result = await store.get("theme");
    assert.equal(result, undefined);
  });

  it("clears all preferences", async () => {
    await store.set("theme", "dark");
    await store.set("language", "en");
    await store.clear();
    const result = await store.list();
    assert.deepEqual(result, {});
  });

  it("persists across instances", async () => {
    await store.set("theme", "dark");
    const store2 = new UserPreferenceStore(testDir);
    await store2.init();
    const result = await store2.get("theme");
    assert.equal(result, "dark");
  });
});