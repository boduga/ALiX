import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { useTestHome, restoreTestHome } from "./test-helpers.js";
import {
  listRepoSkills,
  listAvailableSkills,
  marketplaceIndexPath,
} from "../../../../src/cli/commands/skills/marketplace.js";

const testDir = join(process.cwd(), ".test-alix-marketplace-cache");
const REPO = "https://github.com/acme/skills";

function skillBody(name: string): string {
  return `---\nname: ${name}\ndescription: ${name} test skill\n---\nBody.\n`;
}

function treeResponse(entries: { path: string }[]): Response {
  return new Response(
    JSON.stringify({
      sha: "abc",
      url: "u",
      tree: entries.map((e) => ({
        path: e.path,
        mode: "100644",
        type: "blob",
        sha: "s",
        url: "u",
        size: 1,
      })),
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/** Mock fetch: trees API → tree; raw keys in `raw` → body; else 404. Counts calls. */
function mockFetch(tree: { path: string }[], raw: Record<string, string>, counter: { calls: number }) {
  globalThis.fetch = (async (input: unknown) => {
    counter.calls++;
    const url = String(input);
    if (url.includes("api.github.com")) return treeResponse(tree);
    for (const [key, body] of Object.entries(raw)) {
      if (url.includes(key)) {
        return new Response(body, { status: 200, headers: { "content-type": "text/markdown" } });
      }
    }
    return new Response("404: Not Found", { status: 404, headers: { "content-type": "text/plain" } });
  }) as typeof fetch;
}

function writeIndex(obj: unknown): void {
  mkdirSync(join(testDir, ".alix"), { recursive: true });
  writeFileSync(marketplaceIndexPath(testDir), typeof obj === "string" ? obj : JSON.stringify(obj), "utf8");
}

describe("marketplace index cache", () => {
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    useTestHome(testDir);
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    restoreTestHome(testDir);
  });

  it("fresh hit performs zero fetches (and honors limit by slicing)", async () => {
    const counter = { calls: 0 };
    mockFetch(
      [{ path: "skills/alpha/SKILL.md" }, { path: "skills/beta/SKILL.md" }],
      { "skills/alpha/SKILL.md": skillBody("alpha"), "skills/beta/SKILL.md": skillBody("beta") },
      counter,
    );
    const first = await listRepoSkills(REPO, { homeDir: testDir });
    assert.equal(first.length, 2);
    assert.ok(counter.calls > 0, "cold fetch should hit the network");
    assert.ok(existsSync(marketplaceIndexPath(testDir)), "cache file should be written");

    counter.calls = 0;
    globalThis.fetch = (async () => {
      counter.calls++;
      throw new Error("fetch must not be called on a fresh hit");
    }) as typeof fetch;
    const second = await listRepoSkills(REPO, { homeDir: testDir });
    assert.deepEqual(second.map((s) => s.name).sort(), ["alpha", "beta"]);
    assert.equal(counter.calls, 0);

    // Limit still applies to cached results.
    const sliced = await listRepoSkills(REPO, { homeDir: testDir, limit: 1 });
    assert.equal(sliced.length, 1);
    assert.equal(counter.calls, 0);
  });

  it("a larger limit than the cached fetch refetches", async () => {
    const counter = { calls: 0 };
    const tree = [{ path: "skills/alpha/SKILL.md" }, { path: "skills/beta/SKILL.md" }];
    const raw = {
      "skills/alpha/SKILL.md": skillBody("alpha"),
      "skills/beta/SKILL.md": skillBody("beta"),
    };
    mockFetch(tree, raw, counter);
    const one = await listRepoSkills(REPO, { homeDir: testDir, limit: 1 });
    assert.equal(one.length, 1);
    assert.ok(counter.calls > 0, "cold fetch should hit the network");

    // Same-or-smaller limit serves from cache with zero fetches.
    counter.calls = 0;
    globalThis.fetch = (async () => {
      counter.calls++;
      throw new Error("must not fetch when the cached limit covers the request");
    }) as typeof fetch;
    const again = await listRepoSkills(REPO, { homeDir: testDir, limit: 1 });
    assert.equal(again.length, 1);
    assert.equal(counter.calls, 0);

    // A larger limit refetches and returns the full list.
    counter.calls = 0;
    mockFetch(tree, raw, counter);
    const both = await listRepoSkills(REPO, { homeDir: testDir, limit: 50 });
    assert.equal(both.length, 2);
    assert.ok(counter.calls > 0, "larger limit must refetch");
  });

  it("stale entry triggers refetch and rewrites the cache", async () => {
    writeIndex({
      version: 1,
      entries: {
        "https://github.com/acme/skills": {
          fetchedAt: 0,
          limit: 50,
          skills: [{ name: "old", description: "old", path: "skills/old/SKILL.md", repoUrl: REPO }],
        },
      },
    });
    const counter = { calls: 0 };
    mockFetch([{ path: "skills/new/SKILL.md" }], { "skills/new/SKILL.md": skillBody("new") }, counter);
    const skills = await listRepoSkills(REPO, { homeDir: testDir });
    assert.deepEqual(skills.map((s) => s.name), ["new"]);
    assert.ok(counter.calls > 0, "stale entry should refetch");
    const onDisk = JSON.parse(readFileSync(marketplaceIndexPath(testDir), "utf8"));
    const entry = onDisk.entries["https://github.com/acme/skills"];
    assert.ok(Date.now() - entry.fetchedAt < 60_000, "cache should be rewritten with a fresh timestamp");
    assert.deepEqual(entry.skills.map((s: { name: string }) => s.name), ["new"]);
  });

  it("corrupt cache file refetches and overwrites", async () => {
    writeIndex("not json {{");
    const counter = { calls: 0 };
    mockFetch([{ path: "skills/alpha/SKILL.md" }], { "skills/alpha/SKILL.md": skillBody("alpha") }, counter);
    const skills = await listRepoSkills(REPO, { homeDir: testDir });
    assert.deepEqual(skills.map((s) => s.name), ["alpha"]);
    assert.ok(counter.calls > 0);
    // File must now be valid JSON again.
    const onDisk = JSON.parse(readFileSync(marketplaceIndexPath(testDir), "utf8"));
    assert.equal(onDisk.version, 1);
  });

  it("fetch failure with a stale entry serves stale", async () => {
    const staleSkills = [{ name: "stale", description: "stale", path: "skills/stale/SKILL.md", repoUrl: REPO }];
    writeIndex({
      version: 1,
      entries: { "https://github.com/acme/skills": { fetchedAt: 0, limit: 50, skills: staleSkills } },
    });
    globalThis.fetch = (async () =>
      new Response("403 Forbidden", { status: 403, headers: { "content-type": "application/json" } })) as typeof fetch;
    const skills = await listRepoSkills(REPO, { homeDir: testDir });
    assert.deepEqual(skills.map((s) => s.name), ["stale"]);
  });

  it("refresh:true bypasses a fresh cache", async () => {
    const counter = { calls: 0 };
    mockFetch([{ path: "skills/alpha/SKILL.md" }], { "skills/alpha/SKILL.md": skillBody("alpha") }, counter);
    await listRepoSkills(REPO, { homeDir: testDir });
    assert.ok(counter.calls > 0);

    counter.calls = 0;
    mockFetch([{ path: "skills/beta/SKILL.md" }], { "skills/beta/SKILL.md": skillBody("beta") }, counter);
    const skills = await listRepoSkills(REPO, { homeDir: testDir, refresh: true });
    assert.deepEqual(skills.map((s) => s.name), ["beta"]);
    assert.ok(counter.calls > 0, "refresh should force a refetch");
  });

  it("listAvailableSkills threads refresh/homeDir through to the cache", async () => {
    const mps = [{ name: "acme", url: REPO }];
    const counter = { calls: 0 };
    mockFetch([{ path: "skills/alpha/SKILL.md" }], { "skills/alpha/SKILL.md": skillBody("alpha") }, counter);
    const origLog = console.log;
    const lines: string[] = [];
    console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "));
    try {
      await listAvailableSkills(mps, { homeDir: testDir });
    } finally {
      console.log = origLog;
    }
    assert.ok(counter.calls > 0, "cold listAvailableSkills should fetch");

    // Fresh cache: a second listing performs zero fetches.
    counter.calls = 0;
    globalThis.fetch = (async () => {
      counter.calls++;
      throw new Error("must not fetch on fresh cache");
    }) as typeof fetch;
    console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "));
    try {
      await listAvailableSkills(mps, { homeDir: testDir });
    } finally {
      console.log = origLog;
    }
    assert.equal(counter.calls, 0);

    // refresh:true bypasses even the fresh cache.
    counter.calls = 0;
    mockFetch([{ path: "skills/beta/SKILL.md" }], { "skills/beta/SKILL.md": skillBody("beta") }, counter);
    console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "));
    try {
      await listAvailableSkills(mps, { homeDir: testDir, refresh: true });
    } finally {
      console.log = origLog;
    }
    assert.ok(counter.calls > 0, "refresh should bypass the fresh cache");
  });
});
