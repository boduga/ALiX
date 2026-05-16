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
});