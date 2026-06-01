// tests/mcp/server-registry.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { KNOWN_MCP_SERVERS, findServer } from "../../src/mcp/server-registry.js";

describe("KNOWN_MCP_SERVERS", () => {
  it("contains at least 5 well-known servers", () => {
    assert.ok(KNOWN_MCP_SERVERS.length >= 5);
  });

  it("each server has name, package, description", () => {
    for (const s of KNOWN_MCP_SERVERS) {
      assert.ok(s.name, "server must have name");
      assert.ok(s.package, "server must have package");
      assert.ok(s.description, "server must have description");
    }
  });

  it("includes github, filesystem, fetch", () => {
    const names = KNOWN_MCP_SERVERS.map((s) => s.name);
    assert.ok(names.includes("github"));
    assert.ok(names.includes("filesystem"));
    assert.ok(names.includes("fetch"));
  });
});

describe("findServer", () => {
  it("finds by name", () => {
    const s = findServer("github");
    assert.ok(s);
    assert.equal(s!.name, "github");
  });

  it("returns undefined for unknown", () => {
    assert.equal(findServer("nonexistent"), undefined);
  });
});
