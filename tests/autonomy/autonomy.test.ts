import { describe, it } from "node:test";
import assert from "node:assert";
import { extractInitialScope, createScopeTracker } from "../../src/autonomy/scope-tracker.js";
import { TaskStateMachine, RunLimiter } from "../../src/autonomy/state-machine.js";

describe("extractInitialScope", () => {
  it("extracts quoted paths", () => {
    const paths = extractInitialScope('Fix "src/foo.ts" and "lib/bar.ts"');
    assert.ok(paths.includes("src/foo.ts"), paths.join(", "));
    assert.ok(paths.includes("lib/bar.ts"), paths.join(", "));
  });

  it("extracts paths with slashes", () => {
    const paths = extractInitialScope("Update src/config.ts with new defaults");
    assert.ok(paths.some(p => p.includes("src/config.ts")), paths.join(", "));
  });

  it("extracts multiple file types", () => {
    const paths = extractInitialScope("Refactor auth/auth.ts and auth/routes.ts");
    assert.ok(paths.some(p => p.includes("auth/auth.ts")), paths.join(", "));
    assert.ok(paths.some(p => p.includes("auth/routes.ts")), paths.join(", "));
  });

  it("returns empty for no files", () => {
    const paths = extractInitialScope("Write a test for the login feature");
    assert.strictEqual(paths.length, 0);
  });
});

describe("createScopeTracker", () => {
  it("approves initial scope files for mutation", () => {
    const tracker = createScopeTracker(["src/auth.ts"], "/repo");
    const result = tracker.checkMutation("/repo/src/auth.ts");
    assert.strictEqual(result, "approved");
  });

  it("reports scope expansion for unknown files", () => {
    const tracker = createScopeTracker(["src/auth.ts"], "/repo");
    const result = tracker.checkMutation("/repo/src/other.ts");
    assert.strictEqual(result, "scope_expansion");
  });

  it("allows approved files after approval", () => {
    const tracker = createScopeTracker(["src/auth.ts"], "/repo");
    tracker.approveScope("/repo/src/other.ts");
    const result = tracker.checkMutation("/repo/src/other.ts");
    assert.strictEqual(result, "approved");
  });

  it("clears pending after denial", () => {
    const tracker = createScopeTracker(["src/auth.ts"], "/repo");
    tracker.setPending("/repo/src/other.ts");
    tracker.denyScope("/repo/src/other.ts");
    assert.strictEqual(tracker.pendingApproval, null);
  });

  it("returns denied for previously denied files", () => {
    const tracker = createScopeTracker(["src/auth.ts"], "/repo");
    tracker.denyScope("/repo/src/evil.ts");
    const result = tracker.checkMutation("/repo/src/evil.ts");
    assert.strictEqual(result, "denied");
  });
});

describe("TaskStateMachine", () => {
  it("starts in planning state", () => {
    const limiter = new RunLimiter({ maxIterations: 10, maxRepairs: 3, maxFileChanges: 0, maxShellCommands: 0, maxRuntimeMs: 0 });
    const sm = new TaskStateMachine(limiter);
    assert.strictEqual(sm.currentState, "planning");
  });

  it("transitions to executing on first mutation", () => {
    const limiter = new RunLimiter({ maxIterations: 10, maxRepairs: 3, maxFileChanges: 0, maxShellCommands: 0, maxRuntimeMs: 0 });
    const sm = new TaskStateMachine(limiter);
    const result = sm.toExecuting(false);
    assert.ok(result.allowed);
    assert.strictEqual(sm.currentState, "executing");
  });

  it("blocks transition if scope expansion is pending", () => {
    const limiter = new RunLimiter({ maxIterations: 10, maxRepairs: 3, maxFileChanges: 0, maxShellCommands: 0, maxRuntimeMs: 0 });
    const sm = new TaskStateMachine(limiter);
    const result = sm.toExecuting(true); // scope expansion detected
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.reason, "scope_expansion_pending");
    assert.strictEqual(sm.currentState, "planning"); // still planning
  });

  it("records repair counter", () => {
    const limiter = new RunLimiter({ maxIterations: 10, maxRepairs: 3, maxFileChanges: 0, maxShellCommands: 0, maxRuntimeMs: 0 });
    const sm = new TaskStateMachine(limiter);
    sm._setState("verifying");
    sm.toRepairing();
    assert.strictEqual(sm.snapshot.repairs, 1);
  });

  it("completes successfully", () => {
    const limiter = new RunLimiter({ maxIterations: 10, maxRepairs: 3, maxFileChanges: 0, maxShellCommands: 0, maxRuntimeMs: 0 });
    const sm = new TaskStateMachine(limiter);
    const result = sm.complete();
    assert.ok(result.success);
    assert.strictEqual(result.reason, "completed");
  });

  it("stops on max repairs", () => {
    const limiter = new RunLimiter({ maxIterations: 10, maxRepairs: 3, maxFileChanges: 0, maxShellCommands: 0, maxRuntimeMs: 0 });
    const sm = new TaskStateMachine(limiter);
    sm.recordRepair();
    sm.recordRepair();
    sm.recordRepair();
    const ctx = { state: "repairing" as const, counters: sm.snapshot, scopeExpanded: false, verificationPassed: false, modelSignaledDone: false, pendingScopeFile: null };
    const result = limiter.canTransition("repairing", "verifying", ctx);
    assert.strictEqual(result.allowed, false);
    assert.ok(result.reason?.includes("Max repairs"));
  });
});