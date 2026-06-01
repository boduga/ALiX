// tests/self-extend/registry.test.ts
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  registerInProcess,
  unregisterInProcess,
  listInProcess,
  getInProcess,
  _clearInProcessForTesting,
  type InProcessExtension,
} from "../../src/self-extend/registry.js";

describe("in-process registry", () => {
  beforeEach(() => _clearInProcessForTesting());

  const makeExt = (name: string, type: "skill" | "hook" = "skill"): InProcessExtension => ({
    type,
    name,
    manifest: { type, name, version: "1.0.0" } as any,
    registeredAt: Date.now(),
  });

  it("registers an extension", () => {
    registerInProcess(makeExt("foo"));
    assert.equal(listInProcess().length, 1);
  });

  it("throws on duplicate name+type", () => {
    registerInProcess(makeExt("foo"));
    assert.throws(() => registerInProcess(makeExt("foo")), /already exists/);
  });

  it("unregisters by type+name", () => {
    registerInProcess(makeExt("foo"));
    unregisterInProcess("skill", "foo");
    assert.equal(listInProcess().length, 0);
  });

  it("getInProcess returns the extension", () => {
    registerInProcess(makeExt("foo"));
    const ext = getInProcess("skill", "foo");
    assert.ok(ext);
    assert.equal(ext!.name, "foo");
  });

  it("getInProcess returns undefined for missing", () => {
    assert.equal(getInProcess("skill", "missing"), undefined);
  });

  it("supports different types with same name", () => {
    registerInProcess(makeExt("foo", "skill"));
    registerInProcess(makeExt("foo", "hook"));
    assert.equal(listInProcess().length, 2);
  });
});