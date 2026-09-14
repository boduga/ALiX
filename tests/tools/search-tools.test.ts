import test from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdir, rm, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { grepSearch, globMatch } from "../../src/tools/file-tools.js";
import { FileToolRouter } from "../../src/tools/tool-router.js";
import { inferCapability, canonicalCapabilityOf } from "../../src/tools/capability-map.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";

async function seed(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "search-tools-"));
  await mkdir(join(root, "src", "nested"), { recursive: true });
  await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
  await writeFile(join(root, "src", "a.ts"), "export const alpha = 1;\nconst needle = 2;\n");
  await writeFile(join(root, "src", "nested", "b.ts"), "const needle = 3;\nexport const beta = 4;\n");
  await writeFile(join(root, "src", "c.test.ts"), "test('needle', () => {});\n");
  await writeFile(join(root, "node_modules", "pkg", "ignored.ts"), "const needle = 99;\n");
  await writeFile(join(root, ".gitignore"), "ignored-dir/\n");
  await mkdir(join(root, "ignored-dir"), { recursive: true });
  await writeFile(join(root, "ignored-dir", "x.ts"), "const needle = 100;\n");
  return root;
}

test("grepSearch finds matches across files", async () => {
  const root = await seed();
  try {
    const result = await grepSearch({ root, pattern: "needle" });
    assert.equal(result.kind, "success");
    const matches = (result as { matches: { path: string; lineNumber: number; line: string }[] }).matches;
    const paths = matches.map((m) => m.path).sort();
    assert.deepEqual(paths, ["src/a.ts", "src/c.test.ts", "src/nested/b.ts"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("grepSearch honors headLimit", async () => {
  const root = await seed();
  try {
    const result = await grepSearch({ root, pattern: "needle", headLimit: 1 });
    const matches = (result as { matches: unknown[] }).matches;
    assert.equal(matches.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("grepSearch honors caseSensitive and include globs", async () => {
  const root = await seed();
  try {
    const insensitive = await grepSearch({ root, pattern: "NEEDLE" });
    assert.ok((insensitive as { matches: unknown[] }).matches.length > 0, "default is case-insensitive");

    const sensitive = await grepSearch({ root, pattern: "NEEDLE", caseSensitive: true });
    assert.equal((sensitive as { matches: unknown[] }).matches.length, 0);

    const included = await grepSearch({ root, pattern: "needle", include: ["**/*.test.ts"] });
    const paths = (included as { matches: { path: string }[] }).matches.map((m) => m.path);
    assert.deepEqual(paths, ["src/c.test.ts"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("grepSearch returns an empty success for no matches", async () => {
  const root = await seed();
  try {
    const result = await grepSearch({ root, pattern: "definitely-not-present-xyz" });
    assert.equal(result.kind, "success");
    assert.deepEqual((result as { matches: unknown[] }).matches, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("grepSearch falls back to literal for invalid regex", async () => {
  const root = await seed();
  try {
    const result = await grepSearch({ root, pattern: "(" });
    assert.equal(result.kind, "success");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("grepSearch honors .gitignore and ignores ignored dirs", async () => {
  const root = await seed();
  try {
    const result = await grepSearch({ root, pattern: "needle" });
    const paths = (result as { matches: { path: string }[] }).matches.map((m) => m.path);
    assert.ok(!paths.some((p) => p.startsWith("node_modules/")), "node_modules ignored");
    assert.ok(!paths.some((p) => p.startsWith("ignored-dir/")), ".gitignore honored");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("globMatch matches patterns and bounds results", async () => {
  const root = await seed();
  try {
    const all = await globMatch({ root, pattern: "src/**/*.ts" });
    assert.equal(all.kind, "success");
    const paths = (all as { output: string }).output.split("\n").filter(Boolean).sort();
    assert.deepEqual(paths, ["src/a.ts", "src/c.test.ts", "src/nested/b.ts"]);

    const limited = await globMatch({ root, pattern: "src/**/*.ts", headLimit: 1 });
    assert.equal((limited as { output: string }).output.split("\n").filter(Boolean).length, 1);

    const none = await globMatch({ root, pattern: "src/**/*.nomatch" });
    assert.equal((none as { output: string }).output, "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("FileToolRouter handles grep.search and glob.match", async () => {
  const root = await seed();
  try {
    const router = new FileToolRouter(root);
    assert.equal(router.canHandle("grep.search"), true);
    assert.equal(router.canHandle("glob.match"), true);

    const grep = await router.execute({ toolCallId: "g1", name: "grep.search", args: { pattern: "needle" } });
    assert.equal(grep.kind, "success");

    const glob = await router.execute({ toolCallId: "g2", name: "glob.match", args: { pattern: "src/**/*.ts" } });
    assert.equal(glob.kind, "success");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("FileToolRouter denies outside-workspace and sensitive scopes (non-retryable)", async () => {
  const root = await seed();
  try {
    const router = new FileToolRouter(root);
    const escape = await router.execute({ toolCallId: "g3", name: "grep.search", args: { pattern: "x", path: "../" } });
    assert.equal(escape.kind, "error");
    assert.equal((escape as { retryable?: boolean }).retryable, false);
    assert.match((escape as { message: string }).message, /outside workspace/);

    const sensitive = await router.execute({ toolCallId: "g4", name: "grep.search", args: { pattern: "x", path: ".env" } });
    assert.equal(sensitive.kind, "error");
    assert.match((sensitive as { message: string }).message, /sensitive|protected/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("grep.search/glob.match resolve to the allow-listed file.search capability", () => {
  assert.equal(inferCapability("grep.search"), "file.search");
  assert.equal(inferCapability("glob.match"), "file.search");
  assert.equal(canonicalCapabilityOf("grep.search"), "filesystem.search");
  assert.equal(DEFAULT_CONFIG.permissions.tools["file.search"], "allow");
});

test("dir.search honors headLimit and shares ignore rules (#721)", async () => {
  const root = await seed();
  try {
    const router = new FileToolRouter(root);
    const limited = await router.execute({
      toolCallId: "d1", name: "dir.search", args: { pattern: "needle", headLimit: 1 },
    });
    assert.equal(limited.kind, "success");
    assert.equal((limited as { matches: unknown[] }).matches.length, 1);

    const all = await router.execute({ toolCallId: "d2", name: "dir.search", args: { pattern: "needle" } });
    const paths = (all as { matches: { path: string }[] }).matches.map((m) => m.path);
    assert.ok(!paths.some((p) => p.startsWith("node_modules/")), "node_modules ignored");
    assert.ok(!paths.some((p) => p.startsWith("ignored-dir/")), ".gitignore honored");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
