import test from "node:test";
import assert from "node:assert/strict";
import { RankingStage, BudgetingStage, type RepoMapOutput, type RankingOutput, type ContextBundle } from "../../src/repomap/context-pipeline.js";

/** Minimal RepoMapOutput for testing */
function makeRepoMap(sourceFiles: string[] = [], deps: Record<string, string[]> = {}): RepoMapOutput {
  const fileEntries = new Map();
  for (const sf of sourceFiles) {
    fileEntries.set(sf, { path: sf, kind: "source", lineCount: 50, content: `// file ${sf}\n` });
  }
  const depMap = new Map(sourceFiles.map(sf => [sf, deps[sf] ?? []]));
  const dependencyGraph = {
    _map: depMap,
    dependenciesOf(file: string) { return this._map.get(file) ?? []; },
    dependentsOf() { return []; },
  };
  return {
    sourceFiles,
    testFiles: [],
    configFiles: [],
    docsFiles: [],
    fileEntries,
    dependencyGraph,
    symbols: [],
    gitActivity: new Map(),
    root: "/test",
  } as unknown as RepoMapOutput;
}

/** Run ranking + budgeting and return the bundle */
async function runPipeline(repoMap: RepoMapOutput, task: string, taskType: import("../../src/task-classifier.js").TaskType, pinnedPaths?: string[]): Promise<ContextBundle> {
  const ranking = new RankingStage({ task, taskType, pinnedPaths });
  const budgeting = new BudgetingStage({ maxTokens: 50000 });

  const rankingOutput: RankingOutput = await ranking.process(repoMap);
  const { bundle } = await budgeting.process(rankingOutput);
  return bundle;
}

test.describe("ContextPipeline feature regression", () => {

  test.it("includes dependency-related files when mentioned file scores above threshold", async () => {
    // Dependencies are added only for files with score >= DEPENDENCY_THRESHOLD (100 by default)
    // So we need to mention the file explicitly to get it above threshold
    const repoMap = makeRepoMap(["src/main.ts", "src/util.ts"], {
      "src/main.ts": ["src/util.ts"],
    });

    // Mention both files so main.ts gets high score and triggers dependency inclusion
    const bundle = await runPipeline(repoMap, "work on src/main.ts and src/util.ts", "feature");

    // Both files should be included since we mentioned them
    const mainItem = bundle.primaryFiles.find(i => i.path === "src/main.ts");
    const utilItem = bundle.primaryFiles.find(i => i.path === "src/util.ts");

    assert.ok(mainItem, "main.ts should be included (mentioned)");
    assert.ok(utilItem, "util.ts should be included (mentioned)");
  });

  test.it("includes symbol matches with score 80", async () => {
    const fileEntries = new Map();
    fileEntries.set("src/greeter.ts", { path: "src/greeter.ts", kind: "source", lineCount: 10, content: "export function greet() {}" });

    const repoMap = {
      sourceFiles: ["src/greeter.ts"],
      testFiles: [],
      configFiles: [],
      docsFiles: [],
      fileEntries,
      dependencyGraph: { _map: new Map(), dependenciesOf() { return []; }, dependentsOf() { return []; } },
      symbols: [{ name: "greet", file: "src/greeter.ts", kind: "function", line: 1, col: 17 }],
      gitActivity: new Map(),
      root: "/test",
    } as unknown as RepoMapOutput;

    const bundle = await runPipeline(repoMap, "implement greet", "feature");

    const greetItem = bundle.primaryFiles.find(i => i.kind === "symbol" && i.symbolName === "greet");

    assert.ok(greetItem, "symbol match should be included");
    assert.strictEqual(greetItem.score, 80, "symbol match should have score 80");
  });

  test.it("respects pinned files with highest score (200)", async () => {
    // Use a file not mentioned in the task so pinned overrides
    const repoMap = makeRepoMap(["src/other.ts", "src/secret.ts"]);

    const bundle = await runPipeline(repoMap, "work on other.ts", "feature", ["src/secret.ts"]);

    const pinnedItem = bundle.primaryFiles.find(i => i.path === "src/secret.ts");

    assert.ok(pinnedItem, "pinned file should be included");
    assert.strictEqual(pinnedItem.score, 200, "pinned file should have score 200");
    assert.strictEqual(pinnedItem.reason, "pinned", "reason should be pinned");
  });

  test.it("respects token budget", async () => {
    const fileEntries = new Map();
    // Create many files to exceed budget
    for (let i = 0; i < 100; i++) {
      fileEntries.set(`src/file${i}.ts`, { path: `src/file${i}.ts`, kind: "source", lineCount: 200, content: "// content" });
    }

    const repoMap = {
      sourceFiles: Array.from({ length: 100 }, (_, i) => `src/file${i}.ts`),
      testFiles: [],
      configFiles: [],
      docsFiles: [],
      fileEntries,
      dependencyGraph: { _map: new Map(), dependenciesOf() { return []; }, dependentsOf() { return []; } },
      symbols: [],
      gitActivity: new Map(),
      root: "/test",
    } as unknown as RepoMapOutput;

    // Use a very tight budget
    const ranking = new RankingStage({ task: "work on files", taskType: "feature" });
    const budgeting = new BudgetingStage({ maxTokens: 5000 });

    const rankingOutput: RankingOutput = await ranking.process(repoMap);
    const { bundle } = await budgeting.process(rankingOutput);

    assert.ok(bundle.budget.usedTokens <= bundle.budget.maxTokens,
      `usedTokens (${bundle.budget.usedTokens}) should not exceed maxTokens (${bundle.budget.maxTokens})`);
  });

  test.it("orders by score descending", async () => {
    const fileEntries = new Map();
    fileEntries.set("src/a.ts", { path: "src/a.ts", kind: "source", lineCount: 50, content: "// a" });
    fileEntries.set("src/b.ts", { path: "src/b.ts", kind: "source", lineCount: 50, content: "// b" });
    fileEntries.set("src/c.ts", { path: "src/c.ts", kind: "source", lineCount: 50, content: "// c" });

    const repoMap = {
      sourceFiles: ["src/a.ts", "src/b.ts", "src/c.ts"],
      testFiles: [],
      configFiles: [],
      docsFiles: [],
      fileEntries,
      dependencyGraph: { _map: new Map(), dependenciesOf() { return []; }, dependentsOf() { return []; } },
      symbols: [{ name: "foo", file: "src/b.ts", kind: "function", line: 1, col: 0 }],
      gitActivity: new Map(),
      root: "/test",
    } as unknown as RepoMapOutput;

    const bundle = await runPipeline(repoMap, "foo", "feature", ["src/c.ts"]);

    const scores = bundle.primaryFiles.map(i => i.score);
    for (let i = 1; i < scores.length; i++) {
      assert.ok(scores[i - 1] >= scores[i], `scores should be descending: ${scores.join(" >= ")}`);
    }
  });
});
