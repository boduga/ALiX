import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PreimageValidator } from "../../src/patch/preimage-validator.js";

describe("PreimageValidator", () => {
  const testDir = join(process.cwd(), ".test-preimage");
  let validator: PreimageValidator;

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    validator = new PreimageValidator();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("validates matching preimage hash", async () => {
    const testFile = join(testDir, "test.txt");
    const content = "original content";
    await writeFile(testFile, content);

    const hash = validator.hashContent(content);
    const result = await validator.validate(testFile, hash);

    assert.equal(result.valid, true);
    assert.equal(result.reason, undefined);
  });

  it("rejects stale patch with mismatched hash", async () => {
    const testFile = join(testDir, "test.txt");
    const originalContent = "original content";
    await writeFile(testFile, originalContent);

    // File was modified after read
    const modifiedContent = "modified content";
    await writeFile(testFile, modifiedContent);

    const originalHash = validator.hashContent(originalContent);
    const result = await validator.validate(testFile, originalHash);

    assert.equal(result.valid, false);
    assert.ok(result.reason?.includes("stale"));
    assert.equal(result.expectedHash, originalHash);
    assert.equal(result.actualHash, validator.hashContent(modifiedContent));
  });

  it("rejects patch for non-existent file", async () => {
    const nonExistentFile = join(testDir, "does-not-exist.txt");
    const expectedHash = "somesimulatedhash";

    const result = await validator.validate(nonExistentFile, expectedHash);

    assert.equal(result.valid, false);
    assert.ok(result.reason?.toLowerCase().includes("not found") || result.reason?.toLowerCase().includes("no such file"));
  });

  it("generates checkpoint hash for file", async () => {
    const testFile = join(testDir, "test.txt");
    const content = "checkpoint content";
    await writeFile(testFile, content);

    const checkpointHash = await validator.generateCheckpoint(testFile);
    const expectedHash = validator.hashContent(content);

    assert.equal(checkpointHash, expectedHash);
  });

  it("hashContent produces consistent hashes", () => {
    const content = "test content";
    const hash1 = validator.hashContent(content);
    const hash2 = validator.hashContent(content);

    assert.equal(hash1, hash2);
    assert.equal(hash1.length, 64); // sha256 hex length
  });
});