import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { ContextBundleBuilder } from "../../src/context/context-bundle-builder.js";
import { writeFile, mkdir } from "node:fs/promises";
import { rm } from "node:fs/promises";
import { join } from "node:path";

describe("ContextBundleBuilder", () => {
  const testDir = join(process.cwd(), ".test-bundle");

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    await writeFile(join(testDir, "main.ts"), "export const x = 1;");
    await writeFile(join(testDir, "utils.ts"), "export function helper() {}");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("builds context bundle within token limit", async () => {
    const builder = new ContextBundleBuilder({ maxTokens: 50000 });
    const bundle = await builder.buildBundle(testDir);

    assert.ok(bundle.files.length > 0);
    assert.ok(bundle.totalTokens <= 50000);
    assert.ok(bundle.metadata);
  });

  it("prioritizes high-rank files", async () => {
    const builder = new ContextBundleBuilder({ maxTokens: 10000 });
    const bundle = await builder.buildBundle(testDir);

    // Files should be ordered by relevance
    if (bundle.files.length > 1) {
      assert.ok(bundle.files[0].rank <= bundle.files[1].rank);
    }
  });

  it("excludes files matching exclude patterns", async () => {
    await writeFile(join(testDir, "test.ts"), "export const test = 1;");
    const builder = new ContextBundleBuilder({
      maxTokens: 100000,
      excludePatterns: [".test.ts"]
    });
    const bundle = await builder.buildBundle(testDir);

    assert.ok(!bundle.files.some(f => f.path.endsWith(".test.ts")));
  });
});
