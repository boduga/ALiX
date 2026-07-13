// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FilesystemObservationProvider } from "../../../../src/evolution/observation/providers/filesystem-provider.js";

describe("FilesystemObservationProvider", () => {
  const provider = new FilesystemObservationProvider();
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "a5-fs-test-"));
    writeFileSync(join(tmpDir, "test.txt"), "hello world");
    mkdirSync(join(tmpDir, "subdir"));
    writeFileSync(join(tmpDir, "subdir", "nested.txt"), "nested");
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("has name 'filesystem'", () => {
    assert.equal(provider.name, "filesystem");
  });

  it("checks file exists (pass)", async () => {
    const result = await provider.observe({
      observationId: "obs-1",
      provider: "filesystem",
      description: "File exists",
      params: { path: join(tmpDir, "test.txt"), check: "exists" },
    });
    assert.equal(result.status, "pass");
    assert.equal(result.confidence, 1.0);
  });

  it("checks file exists (fail)", async () => {
    const result = await provider.observe({
      observationId: "obs-2",
      provider: "filesystem",
      description: "File missing",
      expected: true,
      params: { path: join(tmpDir, "nonexistent.txt"), check: "exists" },
    });
    assert.equal(result.status, "fail");
  });

  it("computes file hash", async () => {
    const result = await provider.observe({
      observationId: "obs-3",
      provider: "filesystem",
      description: "File hash",
      params: { path: join(tmpDir, "test.txt"), check: "hash" },
    });
    assert.equal(result.status, "pass");
    assert.equal(typeof result.observed, "string");
    // SHA-256 of "hello world" is known
    assert.equal(result.observed, "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
  });

  it("gets file stat", async () => {
    const result = await provider.observe({
      observationId: "obs-4",
      provider: "filesystem",
      description: "File stat",
      params: { path: join(tmpDir, "test.txt"), check: "stat" },
    });
    assert.equal(result.status, "pass");
    assert.equal(typeof result.evidence.size, "number");
    assert.equal(result.evidence.size, 11); // "hello world".length
  });

  it("returns error for nonexistent path", async () => {
    const result = await provider.observe({
      observationId: "obs-5",
      provider: "filesystem",
      description: "Nonexistent",
      params: { path: "/nonexistent/path/xyz", check: "exists" },
    });
    assert.equal(result.status, "error");
    assert.equal(result.confidence, 0);
  });

  it("returns error for invalid check type", async () => {
    const result = await provider.observe({
      observationId: "obs-6",
      provider: "filesystem",
      description: "Invalid",
      params: { path: "/tmp", check: "invalid" },
    });
    assert.equal(result.status, "error");
  });

  it("reality capture returns pass with file info", async () => {
    const result = await provider.observe({
      observationId: "obs-7",
      provider: "filesystem",
      description: "Capture directory",
      params: { path: tmpDir, check: "exists" },
    });
    assert.equal(result.status, "pass");
    assert.equal(typeof result.observed, "boolean");
  });
});
