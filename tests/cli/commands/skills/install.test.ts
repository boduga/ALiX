import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { runInstall, resolveInstallOptions, atomicInstallSkill } from "../../../../src/cli/commands/skills/install.js";
import { join } from "node:path";
import { existsSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { useTestHome, restoreTestHome } from "./test-helpers.js";

const testDir = join(process.cwd(), ".test-alix-skills");

describe("resolveInstallOptions", () => {
  it("resolves bare 'available' subcommand", () => {
    assert.deepEqual(resolveInstallOptions(["available"]), {
      available: true, list: false, name: undefined, from: undefined, force: false,
    });
  });

  it("resolves 'install <name>' — name is the second arg, not 'install'", () => {
    assert.deepEqual(resolveInstallOptions(["install", "tdd"]), {
      available: false, list: false, name: "tdd", from: undefined, force: false,
    });
  });

  it("resolves 'install --list'", () => {
    assert.deepEqual(resolveInstallOptions(["install", "--list"]), {
      available: false, list: true, name: undefined, from: undefined, force: false,
    });
  });

  it("resolves legacy '--available' flag", () => {
    assert.deepEqual(resolveInstallOptions(["--available"]), {
      available: true, list: false, name: undefined, from: undefined, force: false,
    });
  });

  it("resolves empty args to a bare call (help path)", () => {
    assert.deepEqual(resolveInstallOptions([]), {
      available: false, list: false, name: undefined, from: undefined, force: false,
    });
  });

  it("resolves 'install --from <path>' with an explicit name", () => {
    assert.deepEqual(resolveInstallOptions(["install", "langfuse", "--from", "./langfuse"]), {
      available: false, list: false, name: "langfuse", from: "./langfuse", force: false,
    });
  });

  it("resolves 'install --from <url>' without a name (derived from manifest)", () => {
    assert.deepEqual(resolveInstallOptions(["install", "--from", "https://example.com/skill.md"]), {
      available: false, list: false, name: undefined, from: "https://example.com/skill.md", force: false,
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
      await runInstall({ name: "brand", force: true });
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
    await runInstall({ from: dir, force: true });
    assert.ok(existsSync(join(testDir, ".alix", "skills", "langfuse-agent", "SKILL.md")), "skill should be installed from dir");
  });

  it("installs from a local SKILL.md file (explicit name wins)", async () => {
    const file = writeFixture(VALID);
    await runInstall({ from: file, name: "my-langfuse", force: true });
    assert.ok(existsSync(join(testDir, ".alix", "skills", "my-langfuse", "SKILL.md")), "explicit name should win");
  });

  it("derives name from manifest when not provided", async () => {
    const file = writeFixture(VALID, "whatever.md");
    await runInstall({ from: file, force: true });
    assert.ok(existsSync(join(testDir, ".alix", "skills", "langfuse-agent", "SKILL.md")), "manifest name should be used");
  });

  it("installs from an https URL, deriving name from the manifest", async () => {
    globalThis.fetch = (async () =>
      new Response(VALID, { status: 200, headers: { "content-type": "text/markdown" } })) as typeof fetch;
    try {
      await runInstall({ from: "https://example.com/langfuse-agent.md", force: true });
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

    await runInstall({ from: pkg, force: true });

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

    await runInstall({ from: pkg, force: true });

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
    await runInstall({ from: pkg, force: true });

    const installed = join(testDir, ".alix", "skills", "selfcopy");
    const before = readFileSync(join(installed, "SKILL.md"), "utf8");

    // Re-install pointing --from at the install target itself — must refuse
    // WITHOUT truncating the already-installed SKILL.md to 0 bytes. The self-copy
    // guard runs before the safety gate, so /already installed/ is thrown first.
    await assert.rejects(runInstall({ from: installed, force: true }), /already installed/);
    assert.equal(
      readFileSync(join(installed, "SKILL.md"), "utf8"),
      before,
      "SKILL.md must not be truncated by a self-copy",
    );
    assert.ok(existsSync(join(installed, "scripts", "tool.py")), "existing package files must remain");
  });
});

describe("install --from local repo-root (nested skills)", () => {
  beforeEach(() => {
    useTestHome(testDir);
  });

  afterEach(() => {
    restoreTestHome(testDir);
  });

  /** Write a repo-root fixture with skills/xlsx (SKILL.md + scripts + LICENSE). */
  function writeRepoRoot(): string {
    const root = join(testDir, "fixtures", "repo");
    const skillDir = join(root, "skills", "xlsx");
    const office = join(skillDir, "scripts", "office");
    mkdirSync(office, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: xlsx\ndescription: XLSX recalculation skill\n---\nRecalc the workbook.\n",
    );
    writeFileSync(join(skillDir, "scripts", "recalc.py"), "#!/usr/bin/env python3\n# recalc\n");
    writeFileSync(join(office, "soffice.py"), "#!/usr/bin/env python3\n# soffice\n");
    writeFileSync(join(skillDir, "LICENSE.txt"), "MIT\n");
    return root;
  }

  it("resolves skills/<name>/ from a repo-root and installs the full package", async () => {
    const root = writeRepoRoot();
    await runInstall({ from: root, name: "xlsx", force: true });
    const installed = join(testDir, ".alix", "skills", "xlsx");
    for (const rel of ["SKILL.md", "scripts/recalc.py", "scripts/office/soffice.py", "LICENSE.txt"]) {
      assert.ok(existsSync(join(installed, rel)), `expected ${rel} to be installed from the repo-root`);
    }
  });

  it("installs a single nested skill under its manifest name when no name is given", async () => {
    const root = writeRepoRoot();
    await runInstall({ from: root, force: true });
    const installed = join(testDir, ".alix", "skills", "xlsx");
    assert.ok(existsSync(join(installed, "SKILL.md")), "nested skill installed under its manifest name");
    assert.ok(existsSync(join(installed, "scripts", "recalc.py")), "nested skill scripts land too");
  });

  it("errors on a mismatched name instead of installing the single nested skill under it", async () => {
    const root = writeRepoRoot();
    await assert.rejects(runInstall({ from: root, name: "foo" }), /did you mean/);
    assert.ok(
      !existsSync(join(testDir, ".alix", "skills", "foo", "SKILL.md")),
      "must not install the nested skill under the given (misleading) name",
    );
  });

  it("errors with a helpful message when the requested name has no match", async () => {
    const root = join(testDir, "fixtures", "repo-nomatch");
    const skillDir = join(root, "skills", "alpha");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: alpha\ndescription: Alpha skill\n---\nBody.\n");
    await assert.rejects(runInstall({ from: root, name: "missing" }), /did you mean .*skills\/missing/);
  });

  it("errors when multiple nested skills exist and no name is given", async () => {
    const root = join(testDir, "fixtures", "repo-multi");
    for (const skill of ["alpha", "beta"]) {
      const skillDir = join(root, "skills", skill);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), `---\nname: ${skill}\ndescription: ${skill} skill\n---\nBody.\n`);
    }
    await assert.rejects(runInstall({ from: root }), /pass a name/);
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
    await runInstall({ from: "https://github.com/acme/alix-skills", name: "langfuse-agent", force: true });
    assert.ok(existsSync(join(testDir, ".alix", "skills", "langfuse-agent", "SKILL.md")), "installed from repo-root URL");
  });

  it("resolves a blob URL to the full skill package (SKILL.md + scripts)", async () => {
    mockPackageFetch(
      [{ path: "skills/langfuse-agent/SKILL.md" }, { path: "skills/langfuse-agent/scripts/tool.py" }],
      { "skills/langfuse-agent/SKILL.md": VALID, "skills/langfuse-agent/scripts/tool.py": "print('tool')\n" },
    );
    await runInstall({ from: "https://github.com/acme/alix-skills/blob/main/skills/langfuse-agent/SKILL.md", force: true });
    const installed = join(testDir, ".alix", "skills", "langfuse-agent");
    assert.ok(existsSync(join(installed, "SKILL.md")), "installed from blob URL");
    assert.ok(existsSync(join(installed, "scripts", "tool.py")), "scripts land too from a blob URL");
  });

  it("resolves a tree URL to the full skill package (SKILL.md + scripts)", async () => {
    mockPackageFetch(
      [{ path: "skills/langfuse-agent/SKILL.md" }, { path: "skills/langfuse-agent/scripts/tool.py" }],
      { "skills/langfuse-agent/SKILL.md": VALID, "skills/langfuse-agent/scripts/tool.py": "print('tool')\n" },
    );
    await runInstall({ from: "https://github.com/acme/alix-skills/tree/main/skills/langfuse-agent", force: true });
    const installed = join(testDir, ".alix", "skills", "langfuse-agent");
    assert.ok(existsSync(join(installed, "SKILL.md")), "installed from tree URL");
    assert.ok(existsSync(join(installed, "scripts", "tool.py")), "scripts land too from a tree URL");
  });

  it("installs the full package from a skill-dir URL (SKILL.md + scripts + LICENSE)", async () => {
    mockPackageFetch(
      [
        { path: "skills/xlsx/SKILL.md" },
        { path: "skills/xlsx/scripts/recalc.py" },
        { path: "skills/xlsx/scripts/office/soffice.py" },
        { path: "skills/xlsx/LICENSE.txt" },
      ],
      {
        "skills/xlsx/SKILL.md": "---\nname: xlsx\ndescription: XLSX recalculation skill\n---\nRecalc the workbook.\n",
        "skills/xlsx/scripts/recalc.py": "print('recalc')\n",
        "skills/xlsx/scripts/office/soffice.py": "print('soffice')\n",
        "skills/xlsx/LICENSE.txt": "MIT\n",
      },
    );
    await runInstall({ from: "https://github.com/acme/alix-skills/blob/main/skills/xlsx/SKILL.md", force: true });
    const installed = join(testDir, ".alix", "skills", "xlsx");
    for (const rel of ["SKILL.md", "scripts/recalc.py", "scripts/office/soffice.py", "LICENSE.txt"]) {
      assert.ok(existsSync(join(installed, rel)), `expected ${rel} to land from a GitHub skill-dir URL`);
    }
  });

  it("fetches a raw.githubusercontent.com URL directly", async () => {
    mockRaw(["/alix-skills/main/skills/langfuse-agent/SKILL.md"]);
    await runInstall({ from: "https://raw.githubusercontent.com/acme/alix-skills/main/skills/langfuse-agent/SKILL.md", force: true });
    assert.ok(existsSync(join(testDir, ".alix", "skills", "langfuse-agent", "SKILL.md")), "installed from raw URL");
  });

  it("throws a helpful error when no candidate location has a SKILL.md", async () => {
    mockRaw([]);
    await assert.rejects(
      runInstall({ from: "https://github.com/acme/alix-skills", name: "nope" }),
      /Could not find a valid SKILL\.md/,
    );
  });

  it("restores single-file install for a blob URL pointing at a standalone .md (I-1)", async () => {
    // my-skill.md is a standalone file at the repo root, not a directory: the
    // derived package dir (my-skill.md/) has no SKILL.md blob, so the package
    // fetch must return null and the single-file raw fetch must install it. The
    // tree also lists my-skill.md/scripts/tool.py WITHOUT a raw body — if the
    // package fetch didn't fail fast it would fetch that and hit the 404 mock,
    // so a passing install proves no such fetch happened.
    mockPackageFetch(
      [{ path: "my-skill.md" }, { path: "my-skill.md/scripts/tool.py" }, { path: "README.md" }],
      { "main/my-skill.md": VALID },
    );
    await runInstall({ from: "https://github.com/acme/alix-skills/blob/main/my-skill.md", force: true });
    const installed = join(testDir, ".alix", "skills", "langfuse-agent");
    assert.ok(existsSync(join(installed, "SKILL.md")), "standalone .md blob installs as a single file");
  });

  it("honors the branch ref in a blob URL for both trees and raw fetches (I-2)", async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("api.github.com/repos/acme/alix-skills/git/trees/dev")) {
        return treeResponse([
          { path: "skills/xlsx/SKILL.md" },
          { path: "skills/xlsx/scripts/recalc.py" },
        ]);
      }
      if (url.includes("raw.githubusercontent.com/acme/alix-skills/dev/skills/xlsx/SKILL.md")) {
        return new Response(
          "---\nname: xlsx\ndescription: XLSX recalculation skill\n---\nRecalc the workbook.\n",
          { status: 200, headers: { "content-type": "text/markdown" } },
        );
      }
      if (url.includes("raw.githubusercontent.com/acme/alix-skills/dev/skills/xlsx/scripts/recalc.py")) {
        return new Response("print('recalc')\n", { status: 200, headers: { "content-type": "text/markdown" } });
      }
      return new Response("404: Not Found", { status: 404, headers: { "content-type": "text/plain" } });
    }) as typeof fetch;
    await runInstall({ from: "https://github.com/acme/alix-skills/blob/dev/skills/xlsx/SKILL.md", force: true });
    assert.ok(
      urls.some((u) => u.includes("api.github.com/repos/acme/alix-skills/git/trees/dev")),
      "trees fetch must use the dev ref",
    );
    assert.ok(
      urls.some((u) => u.includes("raw.githubusercontent.com/acme/alix-skills/dev/skills/xlsx/")),
      "raw fetches must use the dev ref",
    );
    assert.ok(!urls.some((u) => u.includes("/HEAD/")), "no HEAD ref may be used");
    const installed = join(testDir, ".alix", "skills", "xlsx");
    assert.ok(existsSync(join(installed, "SKILL.md")), "installed from a dev-ref blob URL");
    assert.ok(existsSync(join(installed, "scripts", "recalc.py")), "scripts land from a dev-ref blob URL");
  });

  it("honors the branch ref in a tree URL (I-2)", async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("api.github.com/repos/acme/alix-skills/git/trees/dev")) {
        return treeResponse([{ path: "skills/xlsx/SKILL.md" }]);
      }
      if (url.includes("raw.githubusercontent.com/acme/alix-skills/dev/skills/xlsx/SKILL.md")) {
        return new Response(
          "---\nname: xlsx\ndescription: XLSX recalculation skill\n---\nRecalc the workbook.\n",
          { status: 200, headers: { "content-type": "text/markdown" } },
        );
      }
      return new Response("404: Not Found", { status: 404, headers: { "content-type": "text/plain" } });
    }) as typeof fetch;
    await runInstall({ from: "https://github.com/acme/alix-skills/tree/dev/skills/xlsx", force: true });
    assert.ok(
      urls.some((u) => u.includes("api.github.com/repos/acme/alix-skills/git/trees/dev")),
      "trees fetch must use the dev ref",
    );
    assert.ok(!urls.some((u) => u.includes("/HEAD/")), "no HEAD ref may be used");
    assert.ok(existsSync(join(testDir, ".alix", "skills", "xlsx", "SKILL.md")), "installed from a dev-ref tree URL");
  });

  it("errors on a given name that does not match the package's manifest name (M-2)", async () => {
    mockPackageFetch(
      [{ path: "skills/xlsx/SKILL.md" }, { path: "skills/xlsx/scripts/recalc.py" }],
      {
        "skills/xlsx/SKILL.md": "---\nname: xlsx\ndescription: XLSX recalculation skill\n---\nRecalc the workbook.\n",
        "skills/xlsx/scripts/recalc.py": "print('recalc')\n",
      },
    );
    await assert.rejects(
      runInstall({ from: "https://github.com/acme/alix-skills/blob/main/skills/xlsx/SKILL.md", name: "foo" }),
      /manifest name is 'xlsx'/,
    );
    assert.ok(
      !existsSync(join(testDir, ".alix", "skills", "foo", "SKILL.md")),
      "must not install a URL package under a misleading name",
    );
  });

  it("installs a URL package under an explicit name that matches the manifest (M-2)", async () => {
    mockPackageFetch(
      [{ path: "skills/xlsx/SKILL.md" }, { path: "skills/xlsx/scripts/recalc.py" }],
      {
        "skills/xlsx/SKILL.md": "---\nname: xlsx\ndescription: XLSX recalculation skill\n---\nRecalc the workbook.\n",
        "skills/xlsx/scripts/recalc.py": "print('recalc')\n",
      },
    );
    await runInstall({ from: "https://github.com/acme/alix-skills/blob/main/skills/xlsx/SKILL.md", name: "xlsx", force: true });
    assert.ok(existsSync(join(testDir, ".alix", "skills", "xlsx", "SKILL.md")), "package installed under matching name");
  });

  it("falls back to the HTML-page error for garbage github.com pages like issues (M-4)", async () => {
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      if (url.includes("api.github.com")) {
        throw new Error("trees API must not be called for a non-blob/tree URL");
      }
      return new Response("<html><body>an issue page</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as typeof fetch;
    await assert.rejects(
      runInstall({ from: "https://github.com/acme/alix-skills/issues/123" }),
      /returned an HTML page, not a skill/,
    );
  });
});

describe("atomicInstallSkill", () => {
  beforeEach(() => {
    useTestHome(testDir);
  });
  afterEach(() => {
    restoreTestHome(testDir);
  });

  it("replaces a previously installed package, removing stale files, with no leftovers", async () => {
    const target = join(testDir, ".alix", "skills", "xlsx");
    await atomicInstallSkill(target, async (tmp) => {
      mkdirSync(join(tmp, "scripts"), { recursive: true });
      writeFileSync(join(tmp, "SKILL.md"), "---\nname: xlsx\ndescription: X\n---\nV1.\n");
      writeFileSync(join(tmp, "scripts", "old.py"), "print('old')\n");
    });
    await atomicInstallSkill(target, async (tmp) => {
      mkdirSync(join(tmp, "scripts"), { recursive: true });
      writeFileSync(join(tmp, "SKILL.md"), "---\nname: xlsx\ndescription: X\n---\nV2.\n");
      writeFileSync(join(tmp, "scripts", "new.py"), "print('new')\n");
    });
    assert.equal(readFileSync(join(target, "SKILL.md"), "utf8").includes("V2"), true);
    assert.ok(!existsSync(join(target, "scripts", "old.py")), "stale file removed on reinstall");
    assert.ok(existsSync(join(target, "scripts", "new.py")));
    const leftovers = readdirSync(join(testDir, ".alix", "skills")).filter(
      (n) => n.includes(".tmp-") || n.includes(".old-"),
    );
    assert.deepEqual(leftovers, [], "no temp/backup leftovers");
  });

  it("leaves an existing install untouched when the build fails", async () => {
    const target = join(testDir, ".alix", "skills", "keep");
    await atomicInstallSkill(target, async (tmp) => {
      writeFileSync(join(tmp, "SKILL.md"), "---\nname: keep\ndescription: K\n---\nOK.\n");
    });
    const before = readFileSync(join(target, "SKILL.md"), "utf8");
    await assert.rejects(
      atomicInstallSkill(target, async () => {
        throw new Error("build failed");
      }),
      /build failed/,
    );
    assert.equal(readFileSync(join(target, "SKILL.md"), "utf8"), before, "target untouched on failed build");
    const leftovers = readdirSync(join(testDir, ".alix", "skills")).filter(
      (n) => n.includes(".tmp-") || n.includes(".old-"),
    );
    assert.deepEqual(leftovers, [], "no temp/backup leftovers after failure");
  });
});

describe("skill install safety gate", () => {
  beforeEach(() => {
    useTestHome(testDir);
  });
  afterEach(() => {
    restoreTestHome(testDir);
  });

  it("blocks a package containing a denied file, even with --force", async () => {
    const pkg = join(testDir, "fixtures", "badpkg");
    mkdirSync(join(pkg, "scripts"), { recursive: true });
    writeFileSync(join(pkg, "SKILL.md"), "---\nname: badpkg\ndescription: Bad package\n---\nBody.\n");
    writeFileSync(join(pkg, "scripts", ".env"), "TOKEN=abc\n");
    await assert.rejects(runInstall({ from: pkg, force: true }), /blocked|refusing/);
    assert.ok(!existsSync(join(testDir, ".alix", "skills", "badpkg", "SKILL.md")), "nothing written on hard deny");
  });

  it("fails closed for unsigned non-interactive installs without --force", async () => {
    const pkg = join(testDir, "fixtures", "cleanpkg");
    mkdirSync(join(pkg, "scripts"), { recursive: true });
    writeFileSync(join(pkg, "SKILL.md"), "---\nname: cleanpkg\ndescription: Clean package\n---\nBody.\n");
    writeFileSync(join(pkg, "scripts", "tool.sh"), "echo hi\n");
    await assert.rejects(runInstall({ from: pkg }), /--force/);
    assert.ok(!existsSync(join(testDir, ".alix", "skills", "cleanpkg", "SKILL.md")), "nothing written when blocked");
  });

  it("installs an unsigned package with --force and records evidence", async () => {
    const pkg = join(testDir, "fixtures", "okpkg");
    mkdirSync(join(pkg, "scripts"), { recursive: true });
    writeFileSync(join(pkg, "SKILL.md"), "---\nname: okpkg\ndescription: OK package\n---\nBody.\n");
    writeFileSync(join(pkg, "scripts", "tool.sh"), "echo hi\n");
    await runInstall({ from: pkg, force: true });
    assert.ok(existsSync(join(testDir, ".alix", "skills", "okpkg", "SKILL.md")), "installed under --force");
    const evidenceFile = join(testDir, ".alix", "security", "evidence.jsonl");
    assert.ok(existsSync(evidenceFile), "evidence file written");
    const raw = readFileSync(evidenceFile, "utf8");
    assert.match(raw, /skill_installed/);
    assert.match(raw, /"approved":true/);
  });

  it("records blocked attempts as evidence too", async () => {
    const pkg = join(testDir, "fixtures", "badpkg2");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "SKILL.md"), "---\nname: badpkg2\ndescription: Bad\n---\nBody.\n");
    writeFileSync(join(pkg, ".env"), "TOKEN=abc\n");
    await assert.rejects(runInstall({ from: pkg, force: true }), /blocked|refusing/);
    const evidenceFile = join(testDir, ".alix", "security", "evidence.jsonl");
    assert.ok(existsSync(evidenceFile));
    assert.match(readFileSync(evidenceFile, "utf8"), /"approved":false/);
  });
});
