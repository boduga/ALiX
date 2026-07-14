import { describe, it } from "node:test";
import assert from "node:assert";
import { extractInitialScope, createScopeTracker, ScopeTracker } from "../../src/autonomy/scope-tracker.js";
import { TaskStateMachine, RunLimiter } from "../../src/autonomy/state-machine.js";
import { extractMutationPaths, recordMutationInSessionState } from "../../src/run.js";

describe("extractInitialScope", () => {
  it("extracts quoted paths", () => {
    const scope = extractInitialScope('Fix "src/foo.ts" and "lib/bar.ts"');
    assert.ok(scope?.files.includes("src/foo.ts"), scope?.files.join(", ")!);
    assert.ok(scope?.files.includes("lib/bar.ts"), scope?.files.join(", ")!);
  });

  it("extracts paths with slashes", () => {
    const scope = extractInitialScope("Update src/config.ts with new defaults");
    assert.ok(scope?.files.some(p => p.includes("src/config.ts")), scope?.files.join(", ")!);
  });

  it("extracts multiple file types", () => {
    const scope = extractInitialScope("Refactor auth/auth.ts and auth/routes.ts");
    assert.ok(scope?.files.some(p => p.includes("auth/auth.ts")), scope?.files.join(", ")!);
    assert.ok(scope?.files.some(p => p.includes("auth/routes.ts")), scope?.files.join(", ")!);
  });

  it("returns empty for no files", () => {
    const scope = extractInitialScope("Write a test for the login feature");
    assert.strictEqual(scope?.files.length, 0);
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

  it("treats zero runtime limit as unlimited", () => {
    const limiter = new RunLimiter({ maxIterations: 10, maxRepairs: 3, maxFileChanges: 0, maxShellCommands: 0, maxRuntimeMs: 0 });
    const sm = new TaskStateMachine(limiter);
    sm.tick(1000);
    const ctx = { state: "planning" as const, counters: sm.snapshot, scopeExpanded: false, verificationPassed: false, modelSignaledDone: false, pendingScopeFile: null };
    const result = limiter.canTransition("planning", "executing", ctx);
    assert.strictEqual(result.allowed, true);
  });

  it("checkCounter returns false when zero means unlimited", () => {
    const limiter = new RunLimiter({ maxIterations: 10, maxRepairs: 3, maxFileChanges: 0, maxShellCommands: 0, maxRuntimeMs: 0 });
    assert.strictEqual(limiter.checkCounter("maxFileChanges", 100), false);
  });
});

describe("extractMutationPaths", () => {
  it("extracts simple file tool path", () => {
    assert.deepStrictEqual(extractMutationPaths("file.create", { path: "src/a.ts" }), ["src/a.ts"]);
  });

  it("extracts search_replace patch paths", () => {
    const patchText = "<<<<<<< SEARCH path=src/a.ts\nold\n=======\nnew\n>>>>>>> REPLACE\n<<<<<<< SEARCH path=src/b.ts\nold\n=======\nnew\n>>>>>>> REPLACE";
    assert.deepStrictEqual(extractMutationPaths("patch.apply", { format: "search_replace", patchText }), ["src/a.ts", "src/b.ts"]);
  });

  it("extracts unified diff patch paths and ignores dev null", () => {
    const patchText = "--- a/src/a.ts\n+++ b/src/a.ts\n@@\n-old\n+new\n--- /dev/null\n+++ b/src/new.ts\n";
    assert.deepStrictEqual(extractMutationPaths("patch.apply", { format: "unified_diff", patchText }), ["src/a.ts", "src/new.ts"]);
  });

  it("extracts structured patch paths", () => {
    const patchText = JSON.stringify({ version: 1, files: [{ path: "src/a.ts" }, { path: "src/b.ts" }] });
    assert.deepStrictEqual(extractMutationPaths("patch.apply", { format: "structured_patch", patchText }), ["src/a.ts", "src/b.ts"]);
  });
});

describe("recordMutationInSessionState", () => {
  it("records patch.apply paths from patchText", () => {
    const state: Parameters<typeof recordMutationInSessionState>[0] = {
      created: new Set<string>(),
      changed: new Set<string>(),
      deleted: new Set<string>(),
      fatalErrors: [] as string[],
      pendingScopeExpansion: false,
    };
    const patchText = "<<<<<<< SEARCH path=src/a.ts\nold\n=======\nnew\n>>>>>>> REPLACE\n<<<<<<< SEARCH path=src/b.ts\nold\n=======\nnew\n>>>>>>> REPLACE";

    recordMutationInSessionState(state, "patch.apply", { format: "search_replace", patchText });

    assert.deepStrictEqual([...state.changed].sort(), ["src/a.ts", "src/b.ts"]);
    assert.equal(state.changed.has(undefined as unknown as string), false);
  });
});
