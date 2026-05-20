import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { InMemoryCacheManager, PersistentCacheManager } from "../../src/utils/cache-manager.js";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("InMemoryCacheManager", () => {
  it("get returns stored value", () => {
    const cache = new InMemoryCacheManager();
    cache.set("key1", "value1");
    assert.equal(cache.get("key1"), "value1");
  });

  it("get returns null for missing key", () => {
    const cache = new InMemoryCacheManager();
    assert.equal(cache.get("missing"), null);
  });

  it("has returns true for stored key", () => {
    const cache = new InMemoryCacheManager();
    cache.set("key1", "value1");
    assert.equal(cache.has("key1"), true);
  });

  it("invalidate removes keys with prefix", () => {
    const cache = new InMemoryCacheManager();
    cache.set("server_github_tool1", "value1");
    cache.set("server_github_tool2", "value2");
    cache.set("server_gitlab_tool1", "value3");
    cache.invalidate("server_github_");
    assert.equal(cache.has("server_github_tool1"), false);
    assert.equal(cache.has("server_github_tool2"), false);
    assert.equal(cache.has("server_gitlab_tool1"), true);
  });

  it("clear removes all keys", () => {
    const cache = new InMemoryCacheManager();
    cache.set("key1", "value1");
    cache.set("key2", "value2");
    cache.clear();
    assert.equal(cache.size, 0);
  });

  it("size returns correct count", () => {
    const cache = new InMemoryCacheManager();
    assert.equal(cache.size, 0);
    cache.set("key1", "value1");
    assert.equal(cache.size, 1);
    cache.set("key2", "value2");
    assert.equal(cache.size, 2);
  });
});

describe("PersistentCacheManager", () => {
  const testCacheDir = join(tmpdir(), "test-cache-" + Date.now());

  beforeEach(() => {
    if (existsSync(testCacheDir)) {
      rmSync(testCacheDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(testCacheDir)) {
      rmSync(testCacheDir, { recursive: true });
    }
  });

  it("persists across instances", () => {
    // Write in first instance
    const cache1 = new PersistentCacheManager(testCacheDir);
    cache1.set("key1", "value1");

    // Read in second instance (new constructor = new process simulation)
    const cache2 = new PersistentCacheManager(testCacheDir);
    assert.equal(cache2.get("key1"), "value1");
    assert.equal(cache2.has("key1"), true);
  });

  it("invalidate removes matching keys", () => {
    const cache = new PersistentCacheManager(testCacheDir);
    cache.set("server_github_tool1", "value1");
    cache.set("server_github_tool2", "value2");
    cache.set("server_gitlab_tool1", "value3");

    cache.invalidate("server_github_");

    assert.equal(cache.has("server_github_tool1"), false);
    assert.equal(cache.has("server_github_tool2"), false);
    assert.equal(cache.has("server_gitlab_tool1"), true);
    assert.equal(cache.get("server_gitlab_tool1"), "value3");
  });

  it("clear removes all keys", () => {
    const cache = new PersistentCacheManager(testCacheDir);
    cache.set("key1", "value1");
    cache.set("key2", "value2");

    cache.clear();

    assert.equal(cache.size, 0);
    assert.equal(cache.has("key1"), false);
    assert.equal(cache.has("key2"), false);
  });
});