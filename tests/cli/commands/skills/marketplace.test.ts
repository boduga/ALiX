import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { useTestHome, restoreTestHome } from "./test-helpers.js";
import {
  DEFAULT_MARKETPLACES,
  loadMarketplaces,
  addMarketplace,
  removeMarketplace,
  listRepoSkills,
  resolveSkillInMarketplaces,
  listAvailableSkills,
  runMarketplaceCommand,
  marketplacesPath,
  fetchSkillPackage,
} from "../../../../src/cli/commands/skills/marketplace.js";
import {
  resolveSkillPackageInMarketplaces,
  type Marketplace,
} from "../../../../src/cli/commands/skills/marketplace.js";

const testDir = join(process.cwd(), ".test-alix-marketplace");

function skillBody(name: string): string {
  return `---\nname: ${name}\ndescription: ${name} test skill\n---\nBody.\n`;
}

/** Run fn while capturing console.log output, then restore. */
async function captureLog<T>(fn: () => Promise<T>): Promise<{ lines: string[]; result: T }> {
  const orig = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  try {
    const result = await fn();
    return { lines, result };
  } finally {
    console.log = orig;
  }
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

/** Mock fetch so api.github.com returns `tree`, raw.githubusercontent.com returns `raw` bodies. */
function mockPackageFetch(tree: { path: string }[], raw: Record<string, string>) {
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url.includes("api.github.com")) return treeResponse(tree);
    for (const [key, body] of Object.entries(raw)) {
      if (url.includes(key)) return new Response(body, { status: 200, headers: { "content-type": "text/markdown" } });
    }
    return new Response("404: Not Found", { status: 404, headers: { "content-type": "text/plain" } });
  }) as typeof fetch;
}

describe("marketplace persistence", () => {
  beforeEach(() => {
    useTestHome(testDir);
  });

  afterEach(() => {
    restoreTestHome(testDir);
  });

  it("seeds defaults on first load and writes marketplaces.json", async () => {
    const mps = await loadMarketplaces();
    assert.deepEqual(mps, [...DEFAULT_MARKETPLACES]);
    assert.ok(existsSync(marketplacesPath(testDir)), "marketplaces.json should be written");
    const onDisk = JSON.parse(readFileSync(marketplacesPath(testDir), "utf8"));
    assert.deepEqual(onDisk, DEFAULT_MARKETPLACES);
  });

  it("adds and persists a marketplace", async () => {
    const { added, marketplaces } = await addMarketplace("acme", "https://github.com/acme/skills");
    assert.equal(added, true);
    assert.ok(marketplaces.some((m) => m.name === "acme"));
    const reloaded = await loadMarketplaces();
    assert.ok(reloaded.some((m) => m.name === "acme" && m.url === "https://github.com/acme/skills"));
  });

  it("removes and persists a marketplace", async () => {
    await addMarketplace("acme", "https://github.com/acme/skills");
    const { removed, marketplaces } = await removeMarketplace("acme");
    assert.equal(removed, true);
    assert.ok(!marketplaces.some((m) => m.name === "acme"));
    const reloaded = await loadMarketplaces();
    assert.ok(!reloaded.some((m) => m.name === "acme"));
  });

  it("throws when removing an unregistered marketplace", async () => {
    await assert.rejects(removeMarketplace("nope"), /not registered/);
  });

  it("tolerates a corrupted marketplaces file by reseeding defaults", async () => {
    mkdirSync(join(testDir, ".alix"), { recursive: true });
    writeFileSync(marketplacesPath(testDir), "not json {{", "utf8");
    const mps = await loadMarketplaces();
    assert.deepEqual(mps, [...DEFAULT_MARKETPLACES]);
  });

  it("reseeds defaults when the file has any invalid entry", async () => {
    mkdirSync(join(testDir, ".alix"), { recursive: true });
    writeFileSync(
      marketplacesPath(testDir),
      JSON.stringify([{ name: "acme", url: "https://github.com/acme/skills" }, { bogus: true }]),
      "utf8",
    );
    const mps = await loadMarketplaces();
    assert.deepEqual(mps, [...DEFAULT_MARKETPLACES]);
  });
});

describe("addMarketplace validation", () => {
  beforeEach(() => {
    useTestHome(testDir);
  });

  afterEach(() => {
    restoreTestHome(testDir);
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
        { path: ".git/skills/SKILL.md" },
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

describe("fetchSkillPackage", () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("returns null when the derived skill dir has no SKILL.md blob, fetching no blobs (I-1)", async () => {
    let rawCalls = 0;
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      if (url.includes("api.github.com")) {
        return treeResponse([{ path: "my-skill.md" }, { path: "my-skill.md/scripts/tool.py" }, { path: "README.md" }]);
      }
      rawCalls++;
      return new Response("404", { status: 404 });
    }) as typeof fetch;
    const pkg = await fetchSkillPackage("https://github.com/acme/alix-skills/blob/main/my-skill.md");
    assert.equal(pkg, null);
    assert.equal(rawCalls, 0, "no blobs may be fetched when the dir has no SKILL.md");
  });

  it("returns null for non blob/tree github.com paths like issues (M-4)", async () => {
    const pkg = await fetchSkillPackage("https://github.com/acme/alix-skills/issues/123");
    assert.equal(pkg, null);
  });

  it("uses the URL ref for both the trees and raw fetches (I-2)", async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("api.github.com")) {
        return treeResponse([
          { path: "skills/xlsx/SKILL.md" },
          { path: "skills/xlsx/scripts/recalc.py" },
        ]);
      }
      if (url.includes("dev/skills/xlsx/SKILL.md")) {
        return new Response(skillBody("xlsx"), { status: 200, headers: { "content-type": "text/markdown" } });
      }
      if (url.includes("dev/skills/xlsx/scripts/recalc.py")) {
        return new Response("print('recalc')\n", { status: 200, headers: { "content-type": "text/markdown" } });
      }
      return new Response("404", { status: 404 });
    }) as typeof fetch;
    const pkg = await fetchSkillPackage("https://github.com/acme/alix-skills/blob/dev/skills/xlsx/SKILL.md");
    assert.ok(pkg, "package fetched");
    assert.ok(
      urls.some((u) => u.includes("api.github.com/repos/acme/alix-skills/git/trees/dev")),
      "trees fetch must use the dev ref",
    );
    assert.ok(
      urls.some((u) => u.includes("raw.githubusercontent.com/acme/alix-skills/dev/")),
      "raw fetches must use the dev ref",
    );
    assert.ok(!urls.some((u) => u.includes("/HEAD/")), "no HEAD ref may be used");
    assert.deepEqual(pkg.files.map((f) => f.relPath).sort(), ["SKILL.md", "scripts/recalc.py"]);
  });

  it("defaults to the HEAD ref for a repo-root URL with a name", async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("api.github.com")) {
        return treeResponse([{ path: "skills/xlsx/SKILL.md" }]);
      }
      if (url.includes("HEAD/skills/xlsx/SKILL.md")) {
        return new Response(skillBody("xlsx"), { status: 200, headers: { "content-type": "text/markdown" } });
      }
      return new Response("404", { status: 404 });
    }) as typeof fetch;
    const pkg = await fetchSkillPackage("https://github.com/acme/alix-skills", { name: "xlsx" });
    assert.ok(pkg, "package fetched");
    assert.ok(
      urls.some((u) => u.includes("api.github.com/repos/acme/alix-skills/git/trees/HEAD")),
      "repo-root + name defaults to HEAD",
    );
  });

  it("appends the name to a parent-dir tree URL (superpowers layout)", async () => {
    // Regression for the brainstorming partial-install: the marketplace
    // is configured as `tree/main/skills` (a tree URL pointing at the
    // skills parent dir), and a specific skill like `brainstorming`
    // lives at `skills/brainstorming/`. The skillDir derivation must
    // append the name to the parent dir, otherwise the prescan looks
    // for `skills/SKILL.md` (which doesn't exist) and fetchSkillPackage
    // returns null — the install then falls back to single-file fetch
    // and the operator gets SKILL.md with no scripts/assets.
    const urls: string[] = [];
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("api.github.com/repos/obra/superpowers/git/trees/main")) {
        return treeResponse([
          { path: "skills/brainstorming/SKILL.md" },
          { path: "skills/brainstorming/scripts/dialogue.md" },
        ]);
      }
      if (url.includes("raw.githubusercontent.com/obra/superpowers/main/skills/brainstorming/SKILL.md")) {
        return new Response(skillBody("brainstorming"), { status: 200, headers: { "content-type": "text/markdown" } });
      }
      if (url.includes("raw.githubusercontent.com/obra/superpowers/main/skills/brainstorming/scripts/dialogue.md")) {
        return new Response("# dialogue\n", { status: 200, headers: { "content-type": "text/markdown" } });
      }
      return new Response("404", { status: 404 });
    }) as typeof fetch;
    const pkg = await fetchSkillPackage("https://github.com/obra/superpowers/tree/main/skills", {
      name: "brainstorming",
    });
    assert.ok(pkg, "package fetched (not null)");
    assert.deepEqual(
      pkg.files.map((f) => f.relPath).sort(),
      ["SKILL.md", "scripts/dialogue.md"],
      "scripts/ should be present in the package",
    );
    // Prescan must NOT have probed skills/SKILL.md (the parent dir), only
    // skills/brainstorming/SKILL.md. The latter is fetched; the former
    // would 404.
    assert.ok(
      !urls.some((u) => u.includes("raw.githubusercontent.com/obra/superpowers/main/skills/SKILL.md")),
      "prescan must not probe the parent dir's SKILL.md",
    );
  });

  it("uses the URL as-is for a direct one-segment skill URL", async () => {
    // Regression for the parent-dir-detection over-broadening: a tree URL
    // whose single path segment IS the skill name (e.g. `tree/main/foo`
    // for a skill called `foo`) must resolve to the skill dir `<foo>`,
    // NOT `<foo>/<foo>`. The parent-dir heuristic should only kick in
    // when the path segment differs from the skill name.
    const urls: string[] = [];
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("api.github.com")) {
        return treeResponse([
          { path: "foo/SKILL.md" },
          { path: "foo/scripts/dialogue.md" },
        ]);
      }
      if (url.endsWith("/main/foo/SKILL.md")) {
        return new Response(skillBody("foo"), { status: 200, headers: { "content-type": "text/markdown" } });
      }
      if (url.endsWith("/main/foo/scripts/dialogue.md")) {
        return new Response("# d\n", { status: 200, headers: { "content-type": "text/markdown" } });
      }
      return new Response("404", { status: 404 });
    }) as typeof fetch;
    const pkg = await fetchSkillPackage("https://github.com/example/repo/tree/main/foo", {
      name: "foo",
    });
    assert.ok(pkg, "package fetched (not null)");
    assert.deepEqual(
      pkg.files.map((f) => f.relPath).sort(),
      ["SKILL.md", "scripts/dialogue.md"],
      "package should contain the direct-skill dir's files, not double-name them",
    );
    // Prescan must NOT have probed foo/foo/SKILL.md (the doubled path).
    assert.ok(
      !urls.some((u) => u.includes("/main/foo/foo/")),
      "prescan must not double-append the name for a direct skill URL",
    );
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
    const lines: string[] = [];
    const origErr = console.error;
    const origLog = console.log;
    console.error = (m: unknown) => {
      errs.push(String(m));
    };
    console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "));
    try {
      await listAvailableSkills(mps);
    } finally {
      console.error = origErr;
      console.log = origLog;
    }
    assert.equal(errs.length, 1, "one marketplace failure should be reported");
    assert.match(errs[0], /bad/);
    assert.ok(
      lines.some((l) => l === "\ngood (https://github.com/good/skills):"),
      "the healthy marketplace block should still print",
    );
  });

  it("prints the grouped block, padEnd(24) alignment, and footer", async () => {
    const mps = [{ name: "good", url: "https://github.com/good/skills" }];
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      if (url.includes("api.github.com")) return treeResponse([{ path: "skills/alpha/SKILL.md" }]);
      return new Response(skillBody("alpha"), { status: 200, headers: { "content-type": "text/markdown" } });
    }) as typeof fetch;

    const { lines } = await captureLog(() => listAvailableSkills(mps));
    assert.equal(lines[0], "\ngood (https://github.com/good/skills):");
    assert.equal(lines[1], `  ${"alpha".padEnd(24)} alpha test skill`);
    assert.equal(lines[2], "\nInstall with: alix skills install <skill>");
  });

  it("truncates long descriptions to a scannable one-liner", async () => {
    const mps = [{ name: "good", url: "https://github.com/good/skills" }];
    const LONG = "---\nname: verbose\ndescription: " + "very long description ".repeat(20) + "\n---\nBody.\n";
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      if (url.includes("api.github.com")) return treeResponse([{ path: "skills/verbose/SKILL.md" }]);
      return new Response(LONG, { status: 200, headers: { "content-type": "text/markdown" } });
    }) as typeof fetch;

    const { lines } = await captureLog(() => listAvailableSkills(mps));
    const row = lines.find((l) => l.startsWith("  verbose")) ?? "";
    // Row = 2-space indent + 24-char name column + 1 space + truncated description (≤120 incl. ellipsis).
    assert.ok(row.length <= 2 + 24 + 1 + 120, "description should be truncated to ~120 chars");
    assert.ok(row.endsWith("…"), "truncated description should end with an ellipsis");
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

  it("falls back to 2-deep skills/<category>/<name>/SKILL.md probe (mattpocock layout)", async () => {
    // Regression for the resolver-depth gap: mattpocock/skills uses
    // skills/engineering/<name>/SKILL.md which neither the root nor the
    // skills/<name>/ probe can reach. The fix unwinds the static-path
    // failure per marketplace, fetches the recursive tree to discover the
    // categories, and tries `skills/<category>/<name>/SKILL.md` for each.
    const mattpocock = { name: "mattpocock", url: "https://github.com/mattpocock/skills" };
    const tree = {
      tree: [
        { path: "skills/engineering", type: "tree" },
        { path: "skills/deprecated", type: "tree" },
        { path: "skills/engineering/wayfinder/SKILL.md", type: "blob" },
        { path: "skills/engineering/wayfinder/assets/diagram.md", type: "blob" },
        { path: "README.md", type: "blob" },
      ],
    };
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      // Tree discovery.
      if (url.includes("/git/trees/HEAD")) {
        return new Response(JSON.stringify(tree), { status: 200, headers: { "content-type": "application/json" } });
      }
      // 2-deep hit for the engineering probe.
      if (url.endsWith("/skills/engineering/wayfinder/SKILL.md")) {
        return new Response(VALID, { status: 200, headers: { "content-type": "text/markdown" } });
      }
      // All other static probes 404.
      return new Response("Not Found", { status: 404, headers: { "content-type": "text/plain" } });
    }) as typeof fetch;
    const res = await resolveSkillInMarketplaces("wayfinder", [mattpocock]);
    assert.equal(res.repoUrl, "https://github.com/mattpocock/skills");
    assert.equal(res.content, VALID);
  });

  it("does not perform the tree fetch when the static 3-path probe succeeds", async () => {
    // The category-discovery optimization only kicks in on the failure
    // path. If the static probe hits, no tree fetch is issued — a
    // regression that re-introduces an unconditional tree fetch would
    // spam the GitHub API on every install.
    let treeFetched = false;
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      if (url.includes("/git/trees/HEAD")) {
        treeFetched = true;
        return new Response(JSON.stringify({ tree: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/skills/foo/SKILL.md")) {
        return new Response(VALID, { status: 200, headers: { "content-type": "text/markdown" } });
      }
      return new Response("Not Found", { status: 404, headers: { "content-type": "text/plain" } });
    }) as typeof fetch;
    const mps = [{ name: "acme", url: "https://github.com/acme/skills" }];
    const res = await resolveSkillInMarketplaces("foo", mps);
    assert.equal(res.repoUrl, "https://github.com/acme/skills");
    assert.equal(res.content, VALID);
    assert.equal(treeFetched, false);
  });

  it("surfaces a clean failure when the tree fetch fails AND static paths fail", async () => {
    // Defensive: if the tree fetch fails (network, rate limit), the
    // resolver must record the marketplace failure using the original
    // static-path error — not the transient tree error. The operator
    // should see the canonical "Could not find skill 'x' in N
    // marketplaces" message with the per-marketplace HTTP 404 detail.
    const mps = [{ name: "broken", url: "https://github.com/broken/skills" }];
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      if (url.includes("/git/trees/HEAD")) {
        return new Response("rate limited", { status: 403, headers: { "content-type": "text/plain" } });
      }
      return new Response("Not Found", { status: 404, headers: { "content-type": "text/plain" } });
    }) as typeof fetch;
    await assert.rejects(
      resolveSkillInMarketplaces("nope", mps),
      /Could not find skill 'nope' in 1 registered marketplaces/,
    );
  });

  it("resolves tree-URL marketplaces (superpowers) via the static probe", async () => {
    // Regression for the second marketplace-resolver gap: superpowers is
    // configured as `tree/main/skills` (the URL is already pointed at the
    // skills subdirectory). The static probe used to generate ONE path —
    // `<subdir>/SKILL.md` — and never `<subdir>/<name>/SKILL.md`. The fix
    // adds the per-name and per-skills-name probes so a flat
    // `skills/<name>/SKILL.md` layout under a tree URL is reachable.
    const superpowers = {
      name: "superpowers",
      url: "https://github.com/obra/superpowers/tree/main/skills",
    };
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      // The static probe hits on the per-name path.
      if (url.endsWith("/main/skills/brainstorming/SKILL.md")) {
        return new Response(VALID, { status: 200, headers: { "content-type": "text/markdown" } });
      }
      // No tree fetch should happen because the static probe succeeded.
      return new Response("Not Found", { status: 404, headers: { "content-type": "text/plain" } });
    }) as typeof fetch;
    const res = await resolveSkillInMarketplaces("brainstorming", [superpowers]);
    assert.equal(res.repoUrl, "https://github.com/obra/superpowers/tree/main/skills");
    assert.equal(res.content, VALID);
  });
});

describe("runMarketplaceCommand", () => {
  beforeEach(() => {
    useTestHome(testDir);
  });

  afterEach(() => {
    restoreTestHome(testDir);
  });

  it("lists registered marketplaces as '<name> <url>'", async () => {
    const { lines } = await captureLog(() => runMarketplaceCommand("list"));
    assert.deepEqual(lines, [
      "anthropics/skills https://github.com/anthropics/skills",
      "langfuse/skills https://github.com/langfuse/skills",
    ]);
  });

  it("adds a marketplace with confirmation and updated list, and persists", async () => {
    const { lines } = await captureLog(() =>
      runMarketplaceCommand("add", "acme", "https://github.com/acme/skills"),
    );
    assert.equal(lines[0], "Added marketplace 'acme' (https://github.com/acme/skills)");
    assert.ok(lines.includes("acme https://github.com/acme/skills"));
    const reloaded = await loadMarketplaces();
    assert.ok(reloaded.some((m) => m.name === "acme"));
  });

  it("reports a duplicate add without throwing", async () => {
    const { lines } = await captureLog(() =>
      runMarketplaceCommand("add", "anthropics/skills", "https://github.com/other/skills"),
    );
    assert.equal(lines[0], "Marketplace 'anthropics/skills' is already registered");
    assert.equal(lines.length, DEFAULT_MARKETPLACES.length + 1, "no new line beyond the message and existing list");
  });

  it("rejects an http URL through the command layer", async () => {
    await assert.rejects(runMarketplaceCommand("add", "acme", "http://github.com/acme/skills"), /https/);
  });

  it("rejects a non-github host through the command layer", async () => {
    await assert.rejects(runMarketplaceCommand("add", "acme", "https://example.com/acme/skills"), /github\.com/);
  });

  it("requires both name and url for add", async () => {
    await assert.rejects(runMarketplaceCommand("add", "acme"), /Usage:/);
  });

  it("removes a marketplace with confirmation and updated list, and persists", async () => {
    await captureLog(() => runMarketplaceCommand("add", "acme", "https://github.com/acme/skills"));
    const { lines } = await captureLog(() => runMarketplaceCommand("remove", "acme"));
    assert.equal(lines[0], "Removed marketplace 'acme'");
    assert.ok(!lines.some((l) => l.startsWith("acme ")));
    const reloaded = await loadMarketplaces();
    assert.ok(!reloaded.some((m) => m.name === "acme"));
  });

  it("throws when removing an unregistered marketplace", async () => {
    await assert.rejects(runMarketplaceCommand("remove", "nope"), /not registered/);
  });

  it("requires a name for remove", async () => {
    await assert.rejects(runMarketplaceCommand("remove"), /Usage:/);
  });
});

describe("resolveSkillPackageInMarketplaces", () => {
  const mps: Marketplace[] = [{ name: "acme", url: "https://github.com/acme/skills" }];
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("returns the full package from a marketplace that has skills/<name>/", async () => {
    mockPackageFetch(
      [{ path: "skills/xlsx/SKILL.md" }, { path: "skills/xlsx/scripts/recalc.py" }],
      {
        "skills/xlsx/SKILL.md": "---\nname: xlsx\ndescription: X\n---\nBody.\n",
        "skills/xlsx/scripts/recalc.py": "print('recalc')\n",
      },
    );
    const hit = await resolveSkillPackageInMarketplaces("xlsx", mps);
    assert.ok(hit);
    assert.equal(hit.repoUrl, "https://github.com/acme/skills");
    assert.equal(hit.pkg.name, "xlsx");
    assert.deepEqual(hit.pkg.files.map((f) => f.relPath).sort(), ["SKILL.md", "scripts/recalc.py"]);
  });

  it("returns null when no marketplace has the skill as a package (single-file fallback)", async () => {
    mockPackageFetch([{ path: "README.md" }], {});
    const hit = await resolveSkillPackageInMarketplaces("nope", mps);
    assert.equal(hit, null);
  });

  it("skips a marketplace whose package fetch fails and tries the next", async () => {
    const mps2: Marketplace[] = [
      { name: "bad", url: "https://github.com/bad/skills" },
      { name: "good", url: "https://github.com/good/skills" },
    ];
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      if (url.includes("bad")) return new Response("boom", { status: 500, headers: { "content-type": "text/plain" } });
      if (url.includes("api.github.com")) return treeResponse([{ path: "skills/xlsx/SKILL.md" }, { path: "skills/xlsx/scripts/recalc.py" }]);
      if (url.includes("skills/xlsx/SKILL.md")) return new Response("---\nname: xlsx\ndescription: X\n---\nBody.\n", { status: 200, headers: { "content-type": "text/markdown" } });
      if (url.includes("skills/xlsx/scripts/recalc.py")) return new Response("print('recalc')\n", { status: 200, headers: { "content-type": "text/markdown" } });
      return new Response("404: Not Found", { status: 404, headers: { "content-type": "text/plain" } });
    }) as typeof fetch;
    const hit = await resolveSkillPackageInMarketplaces("xlsx", mps2);
    assert.ok(hit);
    assert.equal(hit.repoUrl, "https://github.com/good/skills");
  });
});
