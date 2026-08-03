import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { runInstall, resolveInstallOptions } from "../../../../src/cli/commands/skills/install.js";
import { join } from "node:path";
import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { useTestHome, restoreTestHome } from "./test-helpers.js";

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
    useTestHome(testDir);
  });

  afterEach(() => {
    // Clean up test directory and restore the original HOME
    restoreTestHome(testDir);
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

describe("skill remove", () => {
  beforeEach(() => {
    useTestHome(testDir);
  });

  afterEach(() => {
    restoreTestHome(testDir);
  });

  it("removes an installed skill", async () => {
    const VALID = "---\nname: brand\ndescription: Brand skill\n---\nBody.\n";
    mkdirSync(join(testDir, ".alix", "skills", "brand"), { recursive: true });
    writeFileSync(join(testDir, ".alix", "skills", "brand", "SKILL.md"), VALID, "utf8");
    await runInstall({ remove: true, name: "brand" });
    assert.ok(!existsSync(join(testDir, ".alix", "skills", "brand", "SKILL.md")), "skill should be removed");
  });

  it("throws when removing a non-installed skill", async () => {
    await assert.rejects(runInstall({ remove: true, name: "nope" }), /not installed/);
  });

  it("throws when remove is used without a name", async () => {
    await assert.rejects(runInstall({ remove: true }), /Usage: alix skills remove/);
  });
});

describe("install --from (non-bundled skills)", () => {
  const VALID = "---\nname: langfuse-agent\ndescription: Langfuse agent skill\n---\nDo the thing.\n";
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    useTestHome(testDir);
  });

  afterEach(() => {
    restoreTestHome(testDir);
  });

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

  it("installs a full package directory (SKILL.md + scripts + LICENSE)", async () => {
    const pkg = join(testDir, "fixtures", "xlsx");
    const scripts = join(pkg, "scripts");
    const office = join(scripts, "office");
    mkdirSync(office, { recursive: true });
    writeFileSync(
      join(pkg, "SKILL.md"),
      "---\nname: xlsx\ndescription: XLSX recalculation skill\n---\nRecalc the workbook.\n",
    );
    writeFileSync(join(scripts, "recalc.py"), "#!/usr/bin/env python3\n# recalc\n");
    writeFileSync(join(office, "soffice.py"), "#!/usr/bin/env python3\n# soffice\n");
    writeFileSync(join(pkg, "LICENSE.txt"), "MIT\n");

    await runInstall({ from: pkg });

    const installed = join(testDir, ".alix", "skills", "xlsx");
    for (const rel of ["SKILL.md", "scripts/recalc.py", "scripts/office/soffice.py", "LICENSE.txt"]) {
      assert.ok(existsSync(join(installed, rel)), `expected ${rel} to be installed`);
    }
  });

  it("excludes node_modules and .DS_Store when copying a package", async () => {
    const pkg = join(testDir, "fixtures", "excluded");
    mkdirSync(join(pkg, "node_modules", "x"), { recursive: true });
    writeFileSync(join(pkg, "node_modules", "x", "index.js"), "console.log(1)\n");
    writeFileSync(join(pkg, ".DS_Store"), "binary garbage");
    writeFileSync(
      join(pkg, "SKILL.md"),
      "---\nname: excluded\ndescription: Exclusion skill\n---\nBody.\n",
    );

    await runInstall({ from: pkg });

    const installed = join(testDir, ".alix", "skills", "excluded");
    assert.ok(existsSync(join(installed, "SKILL.md")), "SKILL.md should be installed");
    assert.ok(!existsSync(join(installed, "node_modules")), "node_modules should be excluded");
    assert.ok(!existsSync(join(installed, ".DS_Store")), ".DS_Store should be excluded");
  });

  it("refuses a self-copy (source === install target) without truncating SKILL.md", async () => {
    // Pre-install a package the same way a normal install would.
    const pkg = join(testDir, "fixtures", "selfcopy");
    mkdirSync(join(pkg, "scripts"), { recursive: true });
    writeFileSync(
      join(pkg, "SKILL.md"),
      "---\nname: selfcopy\ndescription: Self-copy skill\n---\nBody.\n",
    );
    writeFileSync(join(pkg, "scripts", "tool.py"), "print('tool')\n");
    await runInstall({ from: pkg });

    const installed = join(testDir, ".alix", "skills", "selfcopy");
    const before = readFileSync(join(installed, "SKILL.md"), "utf8");

    // Re-install pointing --from at the install target itself — must refuse
    // WITHOUT truncating the already-installed SKILL.md to 0 bytes.
    await assert.rejects(runInstall({ from: installed }), /already installed/);
    assert.equal(
      readFileSync(join(installed, "SKILL.md"), "utf8"),
      before,
      "SKILL.md must not be truncated by a self-copy",
    );
    assert.ok(existsSync(join(installed, "scripts", "tool.py")), "existing package files must remain");
  });
});

describe("install --from github URLs", () => {
  const VALID = "---\nname: langfuse-agent\ndescription: Langfuse agent skill\n---\nBody.\n";
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    useTestHome(testDir);
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    restoreTestHome(testDir);
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

  /** api.github.com trees response for the given blob paths. */
  function treeResponse(entries: { path: string }[]): Response {
    return new Response(
      JSON.stringify({
        sha: "abc",
        url: "u",
        tree: entries.map((e) => ({ path: e.path, mode: "100644", type: "blob", sha: "s", url: "u", size: 1 })),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }

  /** Stub fetch so api.github.com returns `tree` and raw.githubusercontent.com returns `raw` bodies. */
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

  it("resolves a repo-root URL, finding skills/<name>/SKILL.md", async () => {
    mockRaw(["HEAD/skills/langfuse-agent/SKILL.md"]);
    await runInstall({ from: "https://github.com/acme/alix-skills", name: "langfuse-agent" });
    assert.ok(existsSync(join(testDir, ".alix", "skills", "langfuse-agent", "SKILL.md")), "installed from repo-root URL");
  });

  it("resolves a blob URL to the full skill package (SKILL.md + scripts)", async () => {
    mockPackageFetch(
      [{ path: "skills/langfuse-agent/SKILL.md" }, { path: "skills/langfuse-agent/scripts/tool.py" }],
      { "skills/langfuse-agent/SKILL.md": VALID, "skills/langfuse-agent/scripts/tool.py": "print('tool')\n" },
    );
    await runInstall({ from: "https://github.com/acme/alix-skills/blob/main/skills/langfuse-agent/SKILL.md" });
    const installed = join(testDir, ".alix", "skills", "langfuse-agent");
    assert.ok(existsSync(join(installed, "SKILL.md")), "installed from blob URL");
    assert.ok(existsSync(join(installed, "scripts", "tool.py")), "scripts land too from a blob URL");
  });

  it("resolves a tree URL to the full skill package (SKILL.md + scripts)", async () => {
    mockPackageFetch(
      [{ path: "skills/langfuse-agent/SKILL.md" }, { path: "skills/langfuse-agent/scripts/tool.py" }],
      { "skills/langfuse-agent/SKILL.md": VALID, "skills/langfuse-agent/scripts/tool.py": "print('tool')\n" },
    );
    await runInstall({ from: "https://github.com/acme/alix-skills/tree/main/skills/langfuse-agent" });
    const installed = join(testDir, ".alix", "skills", "langfuse-agent");
    assert.ok(existsSync(join(installed, "SKILL.md")), "installed from tree URL");
    assert.ok(existsSync(join(installed, "scripts", "tool.py")), "scripts land too from a tree URL");
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
