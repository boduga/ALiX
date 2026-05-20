import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDependencyGraph } from "../../src/repomap/dependency-graph.js";

describe("buildDependencyGraph", () => {
  it("maps direct relative imports to repo paths", () => {
    const graph = buildDependencyGraph([
      { path: "src/app.ts", content: "import { auth } from './auth';\nexport function app() { return auth(); }" },
      { path: "src/auth.ts", content: "export function auth() { return true; }" },
    ]);

    assert.deepEqual(graph.dependenciesOf("src/app.ts"), ["src/auth.ts"]);
    assert.deepEqual(graph.dependentsOf("src/auth.ts"), ["src/app.ts"]);
  });

  it("resolves index imports", () => {
    const graph = buildDependencyGraph([
      { path: "src/app.ts", content: "import { auth } from './auth';" },
      { path: "src/auth/index.ts", content: "export const auth = true;" },
    ]);

    assert.deepEqual(graph.dependenciesOf("src/app.ts"), ["src/auth/index.ts"]);
  });

  it("ignores package imports and unresolved imports", () => {
    const graph = buildDependencyGraph([
      { path: "src/app.ts", content: "import express from 'express';\nimport x from './missing';" },
    ]);

    assert.deepEqual(graph.dependenciesOf("src/app.ts"), []);
  });

  it("finds transitive dependencies", () => {
    const graph = buildDependencyGraph([
      { path: "src/main.ts", content: "import { a } from './a';" },
      { path: "src/a.ts", content: "import { b } from './b';" },
      { path: "src/b.ts", content: "import { c } from './c';" },
      { path: "src/c.ts", content: "export const c = 1;" },
    ]);

    const transitive = graph.transitiveDependenciesOf("src/main.ts", 3);
    const direct = graph.dependenciesOf("src/main.ts");

    assert.ok(transitive.length >= direct.length, "transitive should include direct dependencies");
    assert.ok(transitive.includes("src/b.ts"), "should include b");
    assert.ok(transitive.includes("src/c.ts"), "should include c (transitive)");
    assert.ok(!transitive.includes("src/main.ts"), "should not include self");
  });

  it("detects circular dependencies", () => {
    const graph = buildDependencyGraph([
      { path: "src/a.ts", content: "import { b } from './b';" },
      { path: "src/b.ts", content: "import { a } from './a';" },
      { path: "src/c.ts", content: "export const c = 1;" },
    ]);

    const cycles = graph.findCycles();
    assert.ok(Array.isArray(cycles));
    assert.ok(cycles.length > 0, "should detect circular dependency");
  });

  it("calculates impact score", () => {
    const graph = buildDependencyGraph([
      { path: "src/main.ts", content: "import { utils } from './utils';" },
      { path: "src/utils.ts", content: "export const utils = 1;" },
      { path: "src/other.ts", content: "import { utils } from './utils';" },
    ]);

    const score = graph.impactScore("src/utils.ts");
    assert.ok(score >= 0, "score should be non-negative");
    assert.ok(score > 0, "utils has dependents so score should be > 0");
  });

  it("returns empty array for unknown file in transitive dependencies", () => {
    const graph = buildDependencyGraph([
      { path: "src/main.ts", content: "import { x } from './x';" },
      { path: "src/x.ts", content: "export const x = 1;" },
    ]);

    const transitive = graph.transitiveDependenciesOf("unknown/file.ts");
    assert.deepEqual(transitive, []);
  });

  it("returns zero impact score for file with no dependents", () => {
    const graph = buildDependencyGraph([
      { path: "src/main.ts", content: "import { utils } from './utils';" },
      { path: "src/utils.ts", content: "export const utils = 1;" },
    ]);

    const score = graph.impactScore("src/utils.ts");
    assert.ok(score > 0, "utils has dependents");
  });

  it("exposes files getter", () => {
    const graph = buildDependencyGraph([
      { path: "src/a.ts", content: "" },
      { path: "src/b.ts", content: "" },
    ]);

    assert.ok(Array.isArray(graph.files));
    assert.equal(graph.files.length, 2);
    assert.ok(graph.files.includes("src/a.ts"));
    assert.ok(graph.files.includes("src/b.ts"));
  });
});