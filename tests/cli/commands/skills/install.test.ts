import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { runInstall, resolveInstallOptions } from "../../../../src/cli/commands/skills/install.js";
import {
  listMarketplaces,
  addMarketplace,
  removeMarketplace,
  DEFAULT_MARKETPLACES,
} from "../../../../src/cli/commands/skills/marketplace.js";
import { join } from "node:path";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";

const testDir = join(process.cwd(), ".test-alix-skills");

describe("resolveInstallOptions", () => {
  it("resolves bare 'available' subcommand", () => {
    assert.deepEqual(resolveInstallOptions(["available"]), {
      available: true, list: false, name: undefined, from: undefined,
    });
  });

  it("resolves 'install <name>' — name is the second arg, not 'install'", () => {
    assert.deepEqual(resolveInstallOptions(["install", "tdd"]), {
      available: false, list: false, name: "tdd", from: undefined,
    });
  });

  it("resolves 'install --list'", () => {
    assert.deepEqual(resolveInstallOptions(["install", "--list"]), {
      available: false, list: true, name: undefined, from: undefined,
    });
  });

  it("resolves legacy '--available' flag", () => {
    assert.deepEqual(resolveInstallOptions(["--available"]), {
      available: true, list: false, name: undefined, from: undefined,
    });
  });

  it("resolves empty args to a bare call (help path)", () => {
    assert.deepEqual(resolveInstallOptions([]), {
      available: false, list: false, name: undefined, from: undefined,
    });
  });

  it("resolves 'install --from <path>' with an explicit name", () => {
    assert.deepEqual(resolveInstallOptions(["install", "langfuse", "--from", "./langfuse"]), {
      available: false, list: false, name: "langfuse", from: "./langfuse",
    });
  });

  it("resolves 'install --from <url>' without a name (derived from manifest)", () => {
    assert.deepEqual(resolveInstallOptions(["install", "--from", "https://example.com/skill.md"]), {
      available: false, list: false, name: undefined, from: "https://example.com/skill.md",
    });
  });
});

describe("install command", () => {
  beforeEach(() => {
    // Mock HOME to test directory
    process.env.HOME = testDir;
    mkdirSync(join(testDir, ".alix", "skills"), { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should list installed skills", async () => {
    await runInstall({ list: true });
    // Test passes if no error thrown
  });

  it("should throw for a non-existent skill when the marketplace returns 404", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("404: Not Found", { status: 404, headers: { "content-type": "text/plain" } })) as typeof fetch;
    try {
      await assert.rejects(runInstall({ name: "nonexistent" }), /Could not find/);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("auto-resolves and installs a skill from a registered marketplace", async () => {
    const VALID = "---\nname: brand\ndescription: Brand guidelines skill\n---\nFollow the brand.\n";
    // Seed a marketplace registry in the temp HOME so runInstall resolves against it.
    mkdirSync(join(testDir, ".alix"), { recursive: true });
    writeFileSync(
      join(testDir, ".alix", "marketplaces.json"),
      JSON.stringify([{ name: "acme", url: "https://github.com/acme/skills" }], null, 2),
      "utf8",
    );
    const origFetch = globalThis.fetch;
    // resolveSkillInMarketplaces probes HEAD/SKILL.md, HEAD/brand/SKILL.md,
    // then HEAD/skills/brand/SKILL.md — only the last exists here.
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      if (url.includes("HEAD/skills/brand/SKILL.md")) {
        return new Response(VALID, { status: 200, headers: { "content-type": "text/markdown" } });
      }
      return new Response("404: Not Found", { status: 404, headers: { "content-type": "text/plain" } });
    }) as typeof fetch;
    try {
      await runInstall({ name: "brand" });
      assert.ok(
        existsSync(join(testDir, ".alix", "skills", "brand", "SKILL.md")),
        "skill should be installed from a registered marketplace",
      );
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("does not reinstall an already-installed skill", async () => {
    const VALID = "---\nname: brand\ndescription: Brand guidelines skill\n---\nFollow the brand.\n";
    // Pre-install the skill so runInstall hits the already-installed early return.
    mkdirSync(join(testDir, ".alix", "skills", "brand"), { recursive: true });
    writeFileSync(join(testDir, ".alix", "skills", "brand", "SKILL.md"), VALID, "utf8");
    const origFetch = globalThis.fetch;
    const origLog = console.log;
    const lines: string[] = [];
    console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "));
    // Any network call here is a bug — the already-installed guard must short-circuit.
    globalThis.fetch = (async () => {
      throw new Error("fetch should not be called when the skill is already installed");
    }) as typeof fetch;
    try {
      await runInstall({ name: "brand" });
      assert.equal(lines[0], "already installed");
      assert.ok(
        existsSync(join(testDir, ".alix", "skills", "brand", "SKILL.md")),
        "existing skill should be left in place",
      );
    } finally {
      console.log = origLog;
      globalThis.fetch = origFetch;
    }
  });
});

describe("install --from (non-bundled skills)", () => {
  const VALID = "---\nname: langfuse-agent\ndescription: Langfuse agent skill\n---\nDo the thing.\n";
  const origFetch = globalThis.fetch;

  function writeFixture(content: string, fileName = "SKILL.md"): string {
    const dir = join(testDir, "fixtures");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, fileName);
    writeFileSync(file, content);
    return file;
  }

  it("installs from a local directory (name from dir basename)", async () => {
    const dir = join(testDir, "fixtures", "langfuse-agent");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), VALID);
    await runInstall({ from: dir });
    assert.ok(existsSync(join(testDir, ".alix", "skills", "langfuse-agent", "SKILL.md")), "skill should be installed from dir");
  });

  it("installs from a local SKILL.md file (explicit name wins)", async () => {
    const file = writeFixture(VALID);
    await runInstall({ from: file, name: "my-langfuse" });
    assert.ok(existsSync(join(testDir, ".alix", "skills", "my-langfuse", "SKILL.md")), "explicit name should win");
  });

  it("derives name from manifest when not provided", async () => {
    const file = writeFixture(VALID, "whatever.md");
    await runInstall({ from: file });
    assert.ok(existsSync(join(testDir, ".alix", "skills", "langfuse-agent", "SKILL.md")), "manifest name should be used");
  });

  it("installs from an https URL, deriving name from the manifest", async () => {
    globalThis.fetch = (async () =>
      new Response(VALID, { status: 200, headers: { "content-type": "text/markdown" } })) as typeof fetch;
    try {
      await runInstall({ from: "https://example.com/langfuse-agent.md" });
      assert.ok(existsSync(join(testDir, ".alix", "skills", "langfuse-agent", "SKILL.md")), "should install from URL");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("rejects plain http sources", async () => {
    await assert.rejects(runInstall({ from: "http://example.com/skill.md" }), /https/);
  });

  it("throws when the source lacks valid frontmatter", async () => {
    const file = writeFixture("just some text, no manifest", "bad.md");
    await assert.rejects(runInstall({ from: file, name: "bad" }), /valid skill manifest/);
  });
});

describe("install --from github URLs", () => {
  const VALID = "---\nname: langfuse-agent\ndescription: Langfuse agent skill\n---\nBody.\n";
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  /** Stub fetch so only raw.githubusercontent.com paths in `exists` return a skill. */
  function mockRaw(exists: string[]) {
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      if (exists.some((key) => url.includes(key))) {
        return new Response(VALID, { status: 200, headers: { "content-type": "text/markdown" } });
      }
      return new Response("404: Not Found", { status: 404, headers: { "content-type": "text/plain" } });
    }) as typeof fetch;
  }

  it("resolves a repo-root URL, finding skills/<name>/SKILL.md", async () => {
    mockRaw(["HEAD/skills/langfuse-agent/SKILL.md"]);
    await runInstall({ from: "https://github.com/acme/alix-skills", name: "langfuse-agent" });
    assert.ok(existsSync(join(testDir, ".alix", "skills", "langfuse-agent", "SKILL.md")), "installed from repo-root URL");
  });

  it("resolves a blob URL to its raw file", async () => {
    mockRaw(["/main/skills/langfuse-agent/SKILL.md"]);
    await runInstall({ from: "https://github.com/acme/alix-skills/blob/main/skills/langfuse-agent/SKILL.md" });
    assert.ok(existsSync(join(testDir, ".alix", "skills", "langfuse-agent", "SKILL.md")), "installed from blob URL");
  });

  it("resolves a tree URL to <path>/SKILL.md", async () => {
    mockRaw(["/main/skills/langfuse-agent/SKILL.md"]);
    await runInstall({ from: "https://github.com/acme/alix-skills/tree/main/skills/langfuse-agent" });
    assert.ok(existsSync(join(testDir, ".alix", "skills", "langfuse-agent", "SKILL.md")), "installed from tree URL");
  });

  it("fetches a raw.githubusercontent.com URL directly", async () => {
    mockRaw(["/alix-skills/main/skills/langfuse-agent/SKILL.md"]);
    await runInstall({ from: "https://raw.githubusercontent.com/acme/alix-skills/main/skills/langfuse-agent/SKILL.md" });
    assert.ok(existsSync(join(testDir, ".alix", "skills", "langfuse-agent", "SKILL.md")), "installed from raw URL");
  });

  it("throws a helpful error when no candidate location has a SKILL.md", async () => {
    mockRaw([]);
    await assert.rejects(
      runInstall({ from: "https://github.com/acme/alix-skills", name: "nope" }),
      /Could not find a valid SKILL\.md/,
    );
  });
});

describe("marketplace persistence (CLI layer)", () => {
  beforeEach(() => {
    process.env.HOME = testDir;
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("seeds default marketplaces on first list", async () => {
    const mps = await listMarketplaces();
    assert.deepEqual(mps, [...DEFAULT_MARKETPLACES]);
    assert.ok(existsSync(join(testDir, ".alix", "marketplaces.json")), "registry file should be persisted");
  });

  it("adds a marketplace and persists it", async () => {
    await listMarketplaces(); // seed defaults first
    const { added, marketplaces } = await addMarketplace("acme", "https://github.com/acme/skills");
    assert.equal(added, true);
    assert.ok(marketplaces.some((m) => m.name === "acme"));
    const reloaded = await listMarketplaces();
    assert.ok(
      reloaded.some((m) => m.name === "acme" && m.url === "https://github.com/acme/skills"),
      "added marketplace should be persisted",
    );
  });

  it("rejects http:// marketplace URLs", async () => {
    await assert.rejects(addMarketplace("acme", "http://github.com/acme/skills"), /https/);
  });

  it("rejects non-github hosts", async () => {
    await assert.rejects(addMarketplace("acme", "https://example.com/acme/skills"), /github\.com/);
  });

  it("removes a marketplace and persists it", async () => {
    await listMarketplaces(); // seed defaults first
    await addMarketplace("acme", "https://github.com/acme/skills");
    const { removed, marketplaces } = await removeMarketplace("acme");
    assert.equal(removed, true);
    assert.ok(!marketplaces.some((m) => m.name === "acme"));
    const reloaded = await listMarketplaces();
    assert.ok(!reloaded.some((m) => m.name === "acme"), "removed marketplace should be persisted");
  });

  it("throws when removing an unknown marketplace", async () => {
    await assert.rejects(removeMarketplace("nope"), /not registered/);
  });
});
