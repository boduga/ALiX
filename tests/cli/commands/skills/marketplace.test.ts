import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import {
  DEFAULT_MARKETPLACES,
  listMarketplaces,
  addMarketplace,
  removeMarketplace,
  listRepoSkills,
  resolveSkillInMarketplaces,
  listAvailableSkills,
  marketplacesPath,
} from "../../../../src/cli/commands/skills/marketplace.js";

const testDir = join(process.cwd(), ".test-alix-marketplace");

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

describe("marketplace persistence", () => {
  beforeEach(() => {
    process.env.HOME = testDir;
  });

  afterEach(() => {
    delete process.env.HOME;
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it("seeds defaults on first load and writes marketplaces.json", async () => {
    const mps = await listMarketplaces();
    assert.deepEqual(mps, [...DEFAULT_MARKETPLACES]);
    assert.ok(existsSync(marketplacesPath(testDir)), "marketplaces.json should be written");
    const onDisk = JSON.parse(readFileSync(marketplacesPath(testDir), "utf8"));
    assert.deepEqual(onDisk, DEFAULT_MARKETPLACES);
  });

  it("adds and persists a marketplace", async () => {
    const { added, marketplaces } = await addMarketplace("acme", "https://github.com/acme/skills");
    assert.equal(added, true);
    assert.ok(marketplaces.some((m) => m.name === "acme"));
    const reloaded = await listMarketplaces();
    assert.ok(reloaded.some((m) => m.name === "acme" && m.url === "https://github.com/acme/skills"));
  });

  it("removes and persists a marketplace", async () => {
    await addMarketplace("acme", "https://github.com/acme/skills");
    const { removed, marketplaces } = await removeMarketplace("acme");
    assert.equal(removed, true);
    assert.ok(!marketplaces.some((m) => m.name === "acme"));
    const reloaded = await listMarketplaces();
    assert.ok(!reloaded.some((m) => m.name === "acme"));
  });

  it("throws when removing an unregistered marketplace", async () => {
    await assert.rejects(removeMarketplace("nope"), /not registered/);
  });

  it("tolerates a corrupted marketplaces file by reseeding defaults", async () => {
    mkdirSync(join(testDir, ".alix"), { recursive: true });
    writeFileSync(marketplacesPath(testDir), "not json {{", "utf8");
    const mps = await listMarketplaces();
    assert.deepEqual(mps, [...DEFAULT_MARKETPLACES]);
  });
});

describe("addMarketplace validation", () => {
  beforeEach(() => {
    process.env.HOME = testDir;
  });

  afterEach(() => {
    delete process.env.HOME;
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it("rejects plain http URLs", async () => {
    await assert.rejects(addMarketplace("acme", "http://github.com/acme/skills"), /https/);
  });

  it("rejects non-github hosts", async () => {
    await assert.rejects(addMarketplace("acme", "https://example.com/acme/skills"), /github\.com/);
  });

  it("rejects malformed URLs", async () => {
    await assert.rejects(addMarketplace("acme", "not a url"), /Not a valid URL/);
  });

  it("rejects empty names", async () => {
    await assert.rejects(addMarketplace("", "https://github.com/acme/skills"), /name/);
  });

  it("returns added:false on a duplicate name", async () => {
    const { added, marketplaces } = await addMarketplace(
      "anthropics/skills",
      "https://github.com/other/skills",
    );
    assert.equal(added, false);
    assert.equal(marketplaces.length, DEFAULT_MARKETPLACES.length);
  });

  it("returns added:false on a duplicate normalized URL", async () => {
    await addMarketplace("acme", "https://github.com/acme/skills");
    const { added } = await addMarketplace("acme-copy", "https://github.com/acme/skills/");
    assert.equal(added, false);
  });
});

describe("listRepoSkills", () => {
  const origFetch = globalThis.fetch;
  const REPO = "https://github.com/acme/skills";

  /** Stub fetch: trees API → tree; raw.githubusercontent for keys in `raw` → body (may be invalid); else 404. */
  function mockFetch(tree: { path: string }[], raw: Record<string, string>) {
    globalThis.fetch = (async (input: unknown) => {
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

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("includes skills/SKILL.md and excludes dot/tool dirs", async () => {
    mockFetch(
      [
        { path: "skills/alpha/SKILL.md" },
        { path: ".github/SKILL.md" },
        { path: ".cursor/skills/SKILL.md" },
        { path: ".codex-plugin/SKILL.md" },
        { path: ".claude-plugin/SKILL.md" },
        { path: "plugins/skills/SKILL.md" },
        { path: "vendor/SKILL.md" },
        { path: "template/skills/SKILL.md" },
        { path: "dist/skills/SKILL.md" },
        { path: "assets/img/SKILL.md" },
        { path: "node_modules/pkg/SKILL.md" },
        { path: "README.md" },
      ],
      { "skills/alpha/SKILL.md": skillBody("alpha") },
    );
    const skills = await listRepoSkills(REPO);
    assert.equal(skills.length, 1);
    assert.equal(skills[0].name, "alpha");
    assert.equal(skills[0].description, "alpha test skill");
    assert.equal(skills[0].path, "skills/alpha/SKILL.md");
    assert.equal(skills[0].repoUrl, REPO);
  });

  it("skips a raw-fetch/manifest failure and keeps the other skills", async () => {
    mockFetch(
      [
        { path: "skills/good/SKILL.md" },
        { path: "skills/not-a-manifest/SKILL.md" },
      ],
      { "skills/good/SKILL.md": skillBody("good"), "skills/not-a-manifest/SKILL.md": "just text, no frontmatter" },
    );
    const skills = await listRepoSkills(REPO);
    assert.deepEqual(skills.map((s) => s.name), ["good"]);
  });

  it("throws when the trees API fails (e.g. rate-limited 403)", async () => {
    globalThis.fetch = (async () =>
      new Response("403 Forbidden", { status: 403, headers: { "content-type": "application/json" } })) as typeof fetch;
    await assert.rejects(listRepoSkills(REPO), /HTTP 403/);
  });

  it("throws for non-github repo URLs", async () => {
    await assert.rejects(listRepoSkills("https://gitlab.com/acme/skills"), /GitHub/);
  });

  it("caps results at an explicit limit", async () => {
    const entries = Array.from({ length: 60 }, (_, i) => ({ path: `skills/skill-${i}/SKILL.md` }));
    const raw: Record<string, string> = {};
    for (let i = 0; i < 60; i++) raw[`skills/skill-${i}/SKILL.md`] = skillBody(`skill-${i}`);
    mockFetch(entries, raw);
    const skills = await listRepoSkills(REPO, { limit: 3 });
    assert.equal(skills.length, 3);
    assert.deepEqual(skills.map((s) => s.name), ["skill-0", "skill-1", "skill-2"]);
  });

  it("defaults to a 50-skill cap", async () => {
    const entries = Array.from({ length: 60 }, (_, i) => ({ path: `skills/skill-${i}/SKILL.md` }));
    const raw: Record<string, string> = {};
    for (let i = 0; i < 60; i++) raw[`skills/skill-${i}/SKILL.md`] = skillBody(`skill-${i}`);
    mockFetch(entries, raw);
    const skills = await listRepoSkills(REPO);
    assert.equal(skills.length, 50);
  });
});

describe("listAvailableSkills", () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("tolerates a failing marketplace and prints the good one", async () => {
    const mps = [
      { name: "bad", url: "https://github.com/bad/skills" },
      { name: "good", url: "https://github.com/good/skills" },
    ];
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      if (url.includes("bad")) return new Response("403 Forbidden", { status: 403, headers: { "content-type": "application/json" } });
      if (url.includes("api.github.com")) return treeResponse([{ path: "skills/alpha/SKILL.md" }]);
      return new Response(skillBody("alpha"), { status: 200, headers: { "content-type": "text/markdown" } });
    }) as typeof fetch;

    const errs: string[] = [];
    const origErr = console.error;
    console.error = (m: unknown) => {
      errs.push(String(m));
    };
    try {
      await listAvailableSkills(mps);
    } finally {
      console.error = origErr;
    }
    assert.equal(errs.length, 1, "one marketplace failure should be reported");
    assert.match(errs[0], /bad/);
  });
});

describe("resolveSkillInMarketplaces", () => {
  const origFetch = globalThis.fetch;
  const VALID = skillBody("foo");
  const mps = [
    { name: "acme", url: "https://github.com/acme/skills" },
    { name: "globex", url: "https://github.com/globex/skills" },
  ];

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("resolves across repos, preferring the first that has the skill", async () => {
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      if (url.includes("globex") && url.includes("skills/foo/SKILL.md")) {
        return new Response(VALID, { status: 200, headers: { "content-type": "text/markdown" } });
      }
      return new Response("404: Not Found", { status: 404, headers: { "content-type": "text/plain" } });
    }) as typeof fetch;
    const res = await resolveSkillInMarketplaces("foo", mps);
    assert.equal(res.repoUrl, "https://github.com/globex/skills");
    assert.equal(res.content, VALID);
  });

  it("aggregates failures when no marketplace has the skill", async () => {
    globalThis.fetch = (async () =>
      new Response("404: Not Found", { status: 404, headers: { "content-type": "text/plain" } })) as typeof fetch;
    await assert.rejects(
      resolveSkillInMarketplaces("nope", mps),
      /Could not find skill 'nope' in 2 registered marketplaces/,
    );
  });
});
