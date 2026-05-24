import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { DependencyGraph, buildDepGraphFromImports } from "../../src/verifier/dep-graph.js";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

describe("DependencyGraph", () => {
  const testDir = join(process.cwd(), ".test-dep-graph");

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    // Create subdirectories for tests that need them
    await mkdir(join(testDir, "src"), { recursive: true });
    await mkdir(join(testDir, "tests"), { recursive: true });
  });

  afterEach(async () => {
    try { await rm(testDir, { recursive: true }); } catch {}
  });

  it("builds graph from import statements", async () => {
    const files = {
      "a.ts": "import { b } from './b.js';\nimport { c } from './c.js';",
      "b.ts": "import { c } from './c.js';",
      "c.ts": "export const x = 1;",
    };
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(testDir, name), content);
    }

    const graph = await buildDepGraphFromImports(testDir, ["a.ts", "b.ts", "c.ts"]);

    // a imports b and c, b imports c
    assert.ok(graph.depsOf("a.ts").includes("b.ts"));
    assert.ok(graph.depsOf("a.ts").includes("c.ts"));
    assert.ok(graph.depsOf("b.ts").includes("c.ts"));
  });

  it("finds affected tests for changed file", async () => {
    const files = {
      "src/module.ts": "export const x = 1;",
      "tests/module.test.ts": "import { x } from '../src/module.js';",
    };
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(testDir, name), content);
    }

    const graph = await buildDepGraphFromImports(testDir, Object.keys(files));
    const affected = graph.findAffectedTests(["src/module.ts"]);

    assert.ok(affected.length > 0, "Should find tests for changed module");
    assert.ok(affected.some(t => t.includes("module.test")), "Should include module test");
  });

  it("finds affected tests across dependency chain", async () => {
    // Files: a.ts (top), b.ts (depends on a), c.ts (depends on b), tests for each
    const files = {
      "src/a.ts": "export const a = 1;",
      "src/b.ts": "import { a } from './a.js';",
      "src/c.ts": "import { b } from './b.js';",
      "tests/a.test.ts": "import { a } from '../src/a.js';",
      "tests/b.test.ts": "import { b } from '../src/b.js';",
      "tests/c.test.ts": "import { c } from '../src/c.js';",
    };
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(testDir, name), content);
    }

    const graph = await buildDepGraphFromImports(testDir, Object.keys(files));

    // When c.ts changes, tests that import c should be affected
    const affected = graph.findAffectedTests(["src/c.ts"]);
    const testNames = affected.map(t => t.split("/").pop());

    assert.ok(testNames.includes("c.test.ts"), "Should include c.test");
  });
});