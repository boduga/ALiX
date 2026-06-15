import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyCapabilities } from "../../src/kernel/mutation-classifier.js";
import { buildDefaultToolIndex } from "../../src/tools/tool-registry.js";

describe("classifyCapabilities", () => {
  const { registry } = buildDefaultToolIndex();

  it("treats empty metadata as unknown-write", () => {
    assert.equal(classifyCapabilities([], registry), "unknown-write");
  });

  it("classifies file.create as known-write", () => {
    assert.equal(classifyCapabilities(["file.create"], registry), "known-write");
  });

  it("classifies file.delete as known-write", () => {
    assert.equal(classifyCapabilities(["file.delete"], registry), "known-write");
  });

  it("classifies file.read as no-write", () => {
    assert.equal(classifyCapabilities(["file.read"], registry), "no-write");
  });

  it("classifies dir.search as no-write", () => {
    assert.equal(classifyCapabilities(["dir.search"], registry), "no-write");
  });

  it("classifies unknown capabilities as unknown-write", () => {
    assert.equal(classifyCapabilities(["custom.tool"], registry), "unknown-write");
  });

  it("known-write wins over known read-only capability", () => {
    assert.equal(classifyCapabilities(["file.read", "file.create"], registry), "known-write");
  });

  it("matches capability IDs", () => {
    assert.equal(classifyCapabilities(["filesystem.create"], registry), "known-write");
  });

  it("known-write wins over unknown capability", () => {
    assert.equal(classifyCapabilities(["custom.tool", "file.create"], registry), "known-write");
  });

  it("unknown makes an otherwise read-only set unknown-write", () => {
    assert.equal(classifyCapabilities(["file.read", "custom.tool"], registry), "unknown-write");
  });
});
