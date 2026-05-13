import test from "node:test";
import assert from "node:assert/strict";
import { buildRepoMapLite } from "../src/repomap/repomap-lite.js";

test("builds a lightweight repo map", async () => {
  const map = await buildRepoMapLite("fixtures/sample-repo");
  assert.ok(map.configFiles.includes("package.json"));
  assert.ok(map.sourceFiles.includes("src/add.ts"));
  assert.ok(map.testFiles.includes("src/add.test.ts"));
  assert.ok(map.topLevelSymbols.some((symbol) => symbol.name === "add"));
});
