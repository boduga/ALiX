import { describe, it } from "node:test";
import assert from "node:assert";
import { ContextStage, ContextPipeline, RepoMapStage, buildRepoMap, RankingStage, type RankingOutput, type ContextItem } from "../../src/repomap/context-pipeline.js";
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