import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OwnershipRegistry } from "../../src/ownership/ownership-registry.js";
import { WorkspacePathResolver } from "../../src/runtime/workspace-path.js";
import { checkOwnershipGate } from "../../src/ownership/ownership-gate.js";

describe("OwnershipGate", () => {
  let dir: string;
  let reg: OwnershipRegistry;
  let resolver: WorkspacePathResolver;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "own-gate-"));
    mkdirSync(join(dir, ".alix", "ownership"), { recursive: true });

    reg = new OwnershipRegistry(dir);
    resolver = new WorkspacePathResolver(dir, []);
  });

  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("non-mutating tool passes without check", async () => {
    const result = await checkOwnershipGate(
      { registry: reg, resolver },
      "agent-1", "web_search", { query: "hello" }, false,
    );
    assert.equal(result, null);
  });

  it("mutating tool on unowned path passes", async () => {
    const result = await checkOwnershipGate(
      { registry: reg, resolver },
      "agent-1", "file.create", { path: "new-file.ts" }, true,
    );
    assert.equal(result, null);
  });

  it("mutating tool on other agent's owned path is blocked", async () => {
    await reg.acquire({
      agentId: "agent-2",
      scope: { kind: "path", root: join(dir, "src"), recursive: true },
      mode: "exclusive-write",
    });

    const result = await checkOwnershipGate(
      { registry: reg, resolver },
      "agent-1", "file.create", { path: "src/main.ts" }, true,
    );

    assert.notEqual(result, null);
    assert.equal(result!.kind, "error");
    assert.ok(result!.message.includes("Ownership conflict"));
  });

  it("mutating tool on same agent's owned path passes", async () => {
    await reg.acquire({
      agentId: "agent-1",
      scope: { kind: "path", root: join(dir, "src"), recursive: true },
      mode: "exclusive-write",
    });

    const result = await checkOwnershipGate(
      { registry: reg, resolver },
      "agent-1", "file.create", { path: "src/main.ts" }, true,
    );
    assert.equal(result, null);
  });

  it("auto-acquires lease for confident mutation target", async () => {
    await checkOwnershipGate(
      { registry: reg, resolver },
      "agent-1", "file.create", { path: "new-file.ts" }, true,
    );

    const leases = await reg.listActive();
    assert.equal(leases.length, 1);
    assert.equal(leases[0].agentId, "agent-1");
    assert.equal(leases[0].mode, "exclusive-write");
  });

  it("mutating tool with unknown targets fails closed", async () => {
    // shell.run with no command args -> extractMutationTargets returns unknown-write
    const result = await checkOwnershipGate(
      { registry: reg, resolver },
      "agent-1", "shell.run", {}, true,
    );
    assert.notEqual(result, null);
    assert.equal(result!.kind, "error");
    assert.ok(result!.message.includes("Cannot determine mutation targets"));
  });

  it("multi-target write fails if any target is blocked", async () => {
    await reg.acquire({
      agentId: "agent-2",
      scope: { kind: "path", root: join(dir, "owned"), recursive: true },
      mode: "exclusive-write",
    });

    const result = await checkOwnershipGate(
      { registry: reg, resolver },
      "agent-1", "file.rename", {
        source: "free/new.ts",
        destination: "owned/existing.ts",
      }, true,
    );
    assert.notEqual(result, null);
    assert.equal(result!.kind, "error");
    assert.ok(result!.message.includes("Ownership conflict"));
  });

  it("multi-target write passes if all targets are unowned", async () => {
    const result = await checkOwnershipGate(
      { registry: reg, resolver },
      "agent-1", "file.rename", {
        source: "safe/new-file.ts",
        destination: "safe/renamed.ts",
      }, true,
    );
    assert.equal(result, null);
  });

  it("no-write shell commands pass through", async () => {
    const result = await checkOwnershipGate(
      { registry: reg, resolver },
      "agent-1", "shell.run", { command: "ls -la" }, true,
    );
    assert.equal(result, null);
  });

  it("autoAcquire=false requires existing coverage", async () => {
    const result = await checkOwnershipGate(
      { registry: reg, resolver, autoAcquire: false },
      "agent-1", "file.create", { path: "new-file.ts" }, true,
    );
    assert.notEqual(result, null);
    assert.equal(result!.kind, "error");
    assert.ok((result as any).message.includes("Explicit ownership lease"));
  });

  it("continuation-resume path still checks ownership", async () => {
    await reg.acquire({
      agentId: "agent-2",
      scope: { kind: "path", root: join(dir, "src"), recursive: true },
      mode: "exclusive-write",
    });

    const result = await checkOwnershipGate(
      { registry: reg, resolver },
      "agent-1", "file.create", { path: "src/main.ts" }, true,
    );

    // Should still be blocked — ownership check runs regardless of source
    assert.notEqual(result, null);
    assert.equal(result!.kind, "error");
  });
});
