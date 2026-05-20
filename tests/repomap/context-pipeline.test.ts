import { describe, it } from "node:test";
import assert from "node:assert";
import { ContextStage, ContextPipeline, RepoMapStage, buildRepoMap, RankingStage, BudgetingStage, SemanticSearchStage, type RankingOutput, type ContextItem } from "../../src/repomap/context-pipeline.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";

describe("ContextPipeline", () => {
  it("has a run method", () => {
    const pipeline = new ContextPipeline([]);
    assert.equal(typeof pipeline.run, "function");
  });

  it("runs empty pipeline", async () => {
    const pipeline = new ContextPipeline([]);
    const result = await pipeline.run("input");
    assert.equal(result, "input");
  });

  it("runs stages in order", async () => {
    const log: string[] = [];
    const pipeline = new ContextPipeline([
      { name: "first", process: async (i) => { log.push("first"); return `${i}-first`; } },
      { name: "second", process: async (i) => { log.push("second"); return `${i}-second`; } },
    ]);
    const result = await pipeline.run("start");
    assert.equal(result, "start-first-second");
    assert.deepEqual(log, ["first", "second"]);
  });

  it("stageNames returns names", () => {
    const pipeline = new ContextPipeline([
      { name: "one", process: async () => {} },
      { name: "two", process: async () => {} },
    ]);
    assert.deepEqual(pipeline.stageNames, ["one", "two"]);
  });
});

describe("RepoMapStage", () => {
  async function createTestDir(): Promise<string> {
    const dir = join(tmpdir(), `repo-map-test-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    await mkdir(join(dir, "src"), { recursive: true });
    await mkdir(join(dir, "tests"), { recursive: true });
    await writeFile(join(dir, "package.json"), '{"name": "test"}');
    await writeFile(join(dir, "src", "index.ts"), "export const foo = 1;");
    await writeFile(join(dir, "tests", "index.test.ts"), "import { foo } from '../src/index';\nassert.equal(foo, 1);");
    return dir;
  }

  it("builds repo map for a directory", async () => {
    const dir = await createTestDir();
    const result = await buildRepoMap(dir);

    assert.ok(Array.isArray(result.sourceFiles));
    assert.ok(Array.isArray(result.testFiles));
    assert.ok(Array.isArray(result.configFiles));
    assert.ok(Array.isArray(result.docsFiles));
    assert.ok(result.fileEntries instanceof Map);
    assert.ok(result.dependencyGraph !== null);
    assert.ok(Array.isArray(result.symbols));
    assert.ok(result.gitActivity instanceof Map);
    assert.equal(result.root, dir);
  });

  it("returns sourceFiles, testFiles, configFiles arrays", async () => {
    const dir = await createTestDir();
    const result = await buildRepoMap(dir);

    assert.ok(result.sourceFiles.includes("src/index.ts"));
    assert.ok(result.testFiles.includes("tests/index.test.ts"));
    assert.ok(result.configFiles.includes("package.json"));
  });

  it("RepoMapStage implements ContextStage interface", () => {
    const stage = new RepoMapStage();
    assert.equal(typeof stage.name, "string");
    assert.equal(typeof stage.process, "function");
    assert.equal(stage.name, "repo-map");
  });

  it("RepoMapStage builds repo map", async () => {
    const dir = await createTestDir();
    const stage = new RepoMapStage();
    const result = await stage.process({ root: dir });

    assert.ok(Array.isArray(result.sourceFiles));
    assert.ok(result.sourceFiles.length > 0);
    assert.ok(result.sourceFiles.includes("src/index.ts"));
  });
});

describe("RankingStage", () => {
  async function createTestRepo(): Promise<{ root: string; repoMap: import("../../src/repomap/context-pipeline.js").RepoMapOutput }> {
    const dir = join(tmpdir(), `ranking-test-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    await mkdir(join(dir, "src"), { recursive: true });
    await mkdir(join(dir, "tests"), { recursive: true });
    await writeFile(join(dir, "package.json"), '{"name": "test"}');
    await writeFile(join(dir, "src", "index.ts"), "export const foo = 1;");
    await writeFile(join(dir, "src", "utils.ts"), "export const bar = 2;");
    await writeFile(join(dir, "tests", "index.test.ts"), "import { foo } from '../src/index';\nassert.equal(foo, 1);");
    const repoMap: import("../../src/repomap/context-pipeline.js").RepoMapOutput = await buildRepoMap(dir);
    return { root: dir, repoMap };
  }

  it("ranks files by score (highest first)", async () => {
    const { repoMap } = await createTestRepo();
    const stage = new RankingStage({ task: "src/index.ts src/utils.ts", taskType: "feature" });
    const result = await stage.process(repoMap);

    assert.ok(result.items.length > 0);
    assert.ok(result.items[0].score >= result.items[result.items.length - 1].score,
      "Items should be sorted by score descending");
  });

  it("includes pinned files with highest score", async () => {
    const { repoMap } = await createTestRepo();
    const stage = new RankingStage({ task: "", taskType: "feature", pinnedPaths: ["src/index.ts"] });
    const result = await stage.process(repoMap);

    const pinned = result.items.find(i => i.path === "src/index.ts");
    assert.ok(pinned, "Pinned file should be in items");
    assert.equal(pinned!.score, 200, "Pinned files should have score 200");
  });

  it("includes config files", async () => {
    const { repoMap } = await createTestRepo();
    const stage = new RankingStage({ task: "", taskType: "feature" });
    const result = await stage.process(repoMap);

    const configItem = result.items.find(i => i.kind === "config");
    assert.ok(configItem, "Config file should be included");
    assert.ok(result.items.some(i => i.reason === "config_file"), "Config item should have reason 'config_file'");
  });
});

describe("BudgetingStage", () => {
  async function createTestRepo(): Promise<{ root: string; repoMap: import("../../src/repomap/context-pipeline.js").RepoMapOutput }> {
    const dir = join(tmpdir(), `budgeting-test-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    await mkdir(join(dir, "src"), { recursive: true });
    await mkdir(join(dir, "tests"), { recursive: true });
    await writeFile(join(dir, "package.json"), '{"name": "test"}');
    await writeFile(join(dir, "src", "index.ts"), "export const foo = 1;");
    await writeFile(join(dir, "src", "utils.ts"), "export const bar = 2;");
    await writeFile(join(dir, "tests", "index.test.ts"), "import { foo } from '../src/index';\nassert.equal(foo, 1);");
    const repoMap: import("../../src/repomap/context-pipeline.js").RepoMapOutput = await buildRepoMap(dir);
    return { root: dir, repoMap };
  }

  it("respects maxTokens budget", async () => {
    const { repoMap } = await createTestRepo();
    const rankingStage = new RankingStage({ task: "src/index.ts", taskType: "feature" });
    const rankingResult = await rankingStage.process(repoMap);

    // Use a very low budget to force filtering
    const budgetingStage = new BudgetingStage({ maxTokens: 10 });
    const result = await budgetingStage.process(rankingResult);

    assert.ok(result.bundle.budget.maxTokens === 10);
    assert.ok(result.bundle.budget.usedTokens <= 10);
  });

  it("stops adding items when budget exceeded", async () => {
    const { repoMap } = await createTestRepo();
    const rankingStage = new RankingStage({ task: "src/index.ts src/utils.ts", taskType: "feature" });
    const rankingResult = await rankingStage.process(repoMap);

    // Use a budget that will fit at least one item but not all
    const budgetingStage = new BudgetingStage({ maxTokens: 50 });
    const result = await budgetingStage.process(rankingResult);

    // Budget should be respected - at least some items should be filtered
    assert.ok(result.bundle.budget.usedTokens <= result.bundle.budget.maxTokens);
  });

  it("categorizes items into primaryFiles, supportingFiles, tests, pinned", async () => {
    const { repoMap } = await createTestRepo();
    const rankingStage = new RankingStage({
      task: "src/index.ts",
      taskType: "feature",
      pinnedPaths: ["src/index.ts"]
    });
    const rankingResult = await rankingStage.process(repoMap);

    const budgetingStage = new BudgetingStage({ maxTokens: 20000 });
    const result = await budgetingStage.process(rankingResult);

    // Pinned items should be in the pinned array
    assert.ok(Array.isArray(result.bundle.pinned));
    // Items should be categorized
    assert.ok(Array.isArray(result.bundle.primaryFiles));
    assert.ok(Array.isArray(result.bundle.supportingFiles));
    assert.ok(Array.isArray(result.bundle.tests));
    // Config files should be in supportingFiles
    const hasConfig = result.bundle.supportingFiles.some(i => i.kind === "config");
    assert.ok(hasConfig, "Config files should be in supportingFiles");
  });
});

describe("GitActivity Boosting", () => {
  it("ranking stage boosts files by git activity", async () => {
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const tmpDir = await mkdtemp("/tmp/git-activity-test-");
    await writeFile(join(tmpDir, "recent.ts"), "export const a = 1;");
    await writeFile(join(tmpDir, "old.ts"), "export const b = 2;");

    const repoMap = await buildRepoMap(tmpDir);
    const gitActivity = new Map<string, number>([
      ["recent.ts", 5],  // 5 appearances in git log
      ["old.ts", 0],     // not recently touched
    ]);
    repoMap.gitActivity = gitActivity;

    const rankingStage = new RankingStage({
      task: "recent.ts old.ts",
      taskType: "feature",
      gitActivity,
    });

    const result = await rankingStage.process(repoMap);
    const recentItem = result.items.find(i => i.path === "recent.ts");
    const oldItem = result.items.find(i => i.path === "old.ts");

    assert.ok(recentItem, "recent.ts should be included");
    assert.ok(oldItem, "old.ts should be included");
    assert.ok(recentItem!.score > oldItem!.score, "Recent file should score higher with git activity boost");

    await rm(tmpDir, { recursive: true, force: true });
  });

  it("git activity boost caps at 20 points", async () => {
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const tmpDir = await mkdtemp("/tmp/git-activity-cap-test-");
    await writeFile(join(tmpDir, "high-activity.ts"), "export const x = 1;");

    const repoMap = await buildRepoMap(tmpDir);
    const gitActivity = new Map<string, number>([
      ["high-activity.ts", 15],  // 15 appearances = potential 30 boost, capped at 20
    ]);
    repoMap.gitActivity = gitActivity;

    const rankingStage = new RankingStage({
      task: "high-activity.ts",
      taskType: "feature",
      gitActivity,
    });

    const result = await rankingStage.process(repoMap);
    const item = result.items.find(i => i.path === "high-activity.ts");

    assert.ok(item, "high-activity.ts should be included");
    // Base score for exact match is 100, git boost is capped at 20 = 120 max
    assert.ok(item!.score <= 120, "Score should be capped at 120 (100 base + 20 max boost)");

    await rm(tmpDir, { recursive: true, force: true });
  });
});

describe("SemanticSearchStage", () => {
  it("semantic search stage indexes source files", async () => {
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const tmpDir = await mkdtemp("/tmp/semantic-stage-test-");
    const testFile = join(tmpDir, "test.ts");
    await writeFile(testFile, "export function hello() { return 'hi'; }");

    const repoMap = await buildRepoMap(tmpDir);
    const stage = new SemanticSearchStage({ root: tmpDir, task: tmpDir });
    const result = await stage.process(repoMap);

    assert.ok(result.fileEntries.has("test.ts"));
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("ranking stage includes semantic search results", async () => {
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const tmpDir = await mkdtemp("/tmp/semantic-ranking-test-");
    await writeFile(join(tmpDir, "service.ts"), "export class UserService { greet() {} }");

    const repoMap = await buildRepoMap(tmpDir);
    const semanticStage = new SemanticSearchStage({ root: tmpDir, task: "UserService" });
    await semanticStage.process(repoMap);

    const rankingStage = new RankingStage({
      task: "UserService",
      taskType: "feature",
      semanticSearchStage: semanticStage,
    });

    const result = await rankingStage.process(repoMap);
    const semanticMatch = result.items.find(i => i.reason.startsWith("semantic_match:"));
    assert.ok(semanticMatch, "Should include semantic search match");
    assert.equal(semanticMatch!.symbolName, "UserService");

    await rm(tmpDir, { recursive: true, force: true });
  });
});