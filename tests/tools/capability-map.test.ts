import { describe, it } from "node:test";
import assert from "node:assert";
import { inferCapability, isReadonlyCapability, requiresApproval, legacyCapabilityToCanonical } from "../../src/tools/capability-map.js";
import { hashArgs } from "../../src/tools/executor.js";

describe("Capability Map", () => {
  it("maps file tools to file.read", () => {
    assert.equal(inferCapability("alix_file_read"), "file.read");
  });

  it("maps shell tools to shell.run", () => {
    assert.equal(inferCapability("alix_shell_run"), "shell.run");
  });

  it("maps unknown tools to tool.invoke", () => {
    assert.equal(inferCapability("unknown_tool"), "tool.invoke");
  });

  it("identifies readonly capabilities", () => {
    assert.ok(isReadonlyCapability("file.read"));
    assert.ok(isReadonlyCapability("shell.readonly"));
    assert.ok(!isReadonlyCapability("shell.run"));
    assert.ok(!isReadonlyCapability("file.write"));
  });

  it("requiresApproval returns tool policy or default", () => {
    const policy: import("../../src/tools/capability-map.js").PolicyConfig = {
      tools: { "file.write": "ask" },
      default: "deny",
    };
    assert.equal(requiresApproval("file.write", policy), "ask");
    assert.equal(requiresApproval("file.read", policy), "deny");
  });
});

describe("legacyCapabilityToCanonical", () => {
  it("maps file.read to filesystem.read", () => {
    assert.equal(legacyCapabilityToCanonical("file.read"), "filesystem.read");
  });

  it("maps file.write to filesystem.write", () => {
    assert.equal(legacyCapabilityToCanonical("file.write"), "filesystem.write");
  });

  it("maps file.search to filesystem.search", () => {
    assert.equal(legacyCapabilityToCanonical("file.search"), "filesystem.search");
  });

  it("maps shell.run to shell.exec", () => {
    assert.equal(legacyCapabilityToCanonical("shell.run"), "shell.exec");
  });

  it("maps shell.readonly to shell.exec", () => {
    assert.equal(legacyCapabilityToCanonical("shell.readonly"), "shell.exec");
  });

  it("maps git.diff to repo.read", () => {
    assert.equal(legacyCapabilityToCanonical("git.diff"), "repo.read");
  });

  it("maps git.commit and git.push to repo.write", () => {
    assert.equal(legacyCapabilityToCanonical("git.commit"), "repo.write");
    assert.equal(legacyCapabilityToCanonical("git.push"), "repo.write");
  });

  it("maps patch.apply to patch.apply", () => {
    assert.equal(legacyCapabilityToCanonical("patch.apply"), "patch.apply");
  });

  it("maps delegate to agent.delegate", () => {
    assert.equal(legacyCapabilityToCanonical("delegate"), "agent.delegate");
  });

  it("maps task.complete to task.complete", () => {
    assert.equal(legacyCapabilityToCanonical("task.complete"), "task.complete");
  });

  it("maps web.search to web.search", () => {
    assert.equal(legacyCapabilityToCanonical("web.search"), "web.search");
  });

  it("maps web.fetch to web.fetch", () => {
    assert.equal(legacyCapabilityToCanonical("web.fetch"), "web.fetch");
  });

  it("maps mcp.invoke to mcp.invoke", () => {
    assert.equal(legacyCapabilityToCanonical("mcp.invoke"), "mcp.invoke");
  });

  it("maps tool.invoke to tool.invoke", () => {
    assert.equal(legacyCapabilityToCanonical("tool.invoke"), "tool.invoke");
  });

  it("passes through unknown names unchanged", () => {
    assert.equal(legacyCapabilityToCanonical("unknown.capability"), "unknown.capability");
    assert.equal(legacyCapabilityToCanonical("foo.bar.baz"), "foo.bar.baz");
    assert.equal(legacyCapabilityToCanonical(""), "");
  });
});

describe("hashArgs", () => {
  it("produces deterministic output for the same args", () => {
    const args = { path: "/foo", command: "ls" };
    const h1 = hashArgs(args);
    const h2 = hashArgs(args);
    assert.equal(h1, h2);
  });

  it("produces different output for different args", () => {
    const h1 = hashArgs({ a: 1 });
    const h2 = hashArgs({ a: 2 });
    assert.notEqual(h1, h2);
  });

  it("produces the same hash regardless of key order", () => {
    const h1 = hashArgs({ a: 1, b: 2 });
    const h2 = hashArgs({ b: 2, a: 1 });
    assert.equal(h1, h2);
  });

  it("produces a SHA-256 hex string (64 chars)", () => {
    const h = hashArgs({ test: true });
    assert.equal(h.length, 64);
    assert.match(h, /^[0-9a-f]{64}$/);
  });

  it("handles nested objects deterministically", () => {
    const h1 = hashArgs({ nested: { b: 2, a: 1 } });
    const h2 = hashArgs({ nested: { a: 1, b: 2 } });
    assert.equal(h1, h2);
  });

  it("handles empty args", () => {
    const h = hashArgs({});
    assert.equal(h.length, 64);
    assert.match(h, /^[0-9a-f]{64}$/);
  });
});
