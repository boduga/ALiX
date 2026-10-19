/**
 * legacy-approval-single-use.test.ts — R1.5 single-use approval regressions.
 *
 * A durable approval authorizes exactly ONE exact invocation. This suite proves
 * that with real shell effects (never just the returned verdict), across both
 * execution routes:
 *
 *  - the ordinary retry route (`ToolExecutor.dispatch`);
 *  - the continuation-resume route (`ContinuationManager` → executor);
 *
 * and that the authorization is bound to the exact capability, args, session
 * and agent — a changed dimension re-asks instead of reusing, and a legacy
 * record with no binding fails closed.
 *
 * RECONSTRUCTED 2026-10-19 after the /tmp wipe destroyed the original file and
 * its fix commit. The contract and effects are unchanged; see the handoff
 * `docs/2026-10-19-legacy-approval-single-use-opencode-handoff.md` §16.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createToolExecutor } from "../../src/capabilities/tools/tool-executor-factory.js";
import type { ToolExecutor } from "../../src/capabilities/tools/tool-executor-factory.js";
import { hashArgs } from "../../src/capabilities/tools/hash-args.js";
import { DEFAULT_CONFIG } from "../../src/operations/config/defaults.js";
import { ApprovalStore } from "../../src/governance/approvals/approval-store.js";
import { EventLog } from "../../src/runtime-state/events/event-log.js";
import { ContinuationStore } from "../../src/runtime-state/runtime/continuation-store.js";
import { ContinuationManager } from "../../src/runtime-state/runtime/continuation-manager.js";
import type { AlixConfig } from "../../src/operations/config/schema.js";

const EFFECT_CMD = "printf 'effect\\n' >> effects.txt";
const OTHER_CMD = "printf 'other\\n' >> effects.txt";

let seq = 0;

interface Fixture {
  root: string;
  log: EventLog;
  store: ApprovalStore;
  config: AlixConfig;
  executor: ToolExecutor;
  cleanup: () => void;
}

async function makeFixture(label: string): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), `alix-single-use-${label}-`));
  mkdirSync(join(root, ".alix", "approvals"), { recursive: true });
  const log = new EventLog(join(root, ".alix", "sessions", "test"));
  await log.init();
  const store = new ApprovalStore(root, { eventLog: log });
  await store.load();

  const config = structuredClone(DEFAULT_CONFIG);
  config.permissions.sessionMode = "ask";
  config.permissions.tools = { "shell.run": "ask", "file.read": "ask", "file.create": "ask" };

  const executor = createToolExecutor({ config, log, root, approvalStore: store });
  return { root, log, store, config, executor, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function effectCount(root: string): number {
  if (!existsSync(join(root, "effects.txt"))) return 0;
  return readFileSync(join(root, "effects.txt"), "utf8").trim().split("\n").filter(Boolean).length;
}

function shellRequest(overrides: {
  toolCallId?: string;
  command?: string;
  agentId?: string;
  name?: string;
  args?: Record<string, unknown>;
} = {}) {
  return {
    toolCallId: overrides.toolCallId ?? `call-${seq++}`,
    name: overrides.name ?? "shell.run",
    args: overrides.args ?? { command: overrides.command ?? EFFECT_CMD },
    agentId: overrides.agentId ?? "agent-one",
  };
}

/** Run the call once (gated → ask), approve the resulting record, return its id. */
async function askAndApprove(f: Fixture, request: ReturnType<typeof shellRequest>): Promise<string> {
  const first = await f.executor.execute(request);
  assert.equal(first.kind, "denied", "first attempt must be gated");
  const approvalId = (first as { approvalId?: string }).approvalId;
  assert.ok(approvalId, "gated call must carry an approvalId");
  await f.store.resolve(approvalId, "approved", "single-use fixture");
  return approvalId;
}

async function makeContinuationManager(f: Fixture): Promise<ContinuationManager> {
  const cs = new ContinuationStore(f.root);
  await cs.load();
  return new ContinuationManager({
    approvalStore: f.store,
    continuationStore: cs,
    eventLog: f.log,
    executeTool: (call) => f.executor.execute(call as never),
  });
}

async function persistContinuation(
  f: Fixture,
  approvalId: string,
  request: ReturnType<typeof shellRequest>,
): Promise<void> {
  const cs = new ContinuationStore(f.root);
  await cs.load();
  await cs.persist({
    approvalId,
    kind: "tool",
    sessionId: "test",
    cwd: f.root,
    toolCall: {
      toolCallId: request.toolCallId,
      name: request.name,
      capability: "shell.run",
      args: request.args,
      argsHash: hashArgs(request.args),
      agentId: request.agentId,
    },
    createdAt: new Date().toISOString(),
  });
}

describe("legacy approval single-use (ordinary retry route)", () => {
  it("executes exactly once and refuses a fresh-process replay", async () => {
    const f = await makeFixture("exec-once");
    try {
      const request = shellRequest();
      await askAndApprove(f, request);
      assert.equal((await f.executor.execute(request)).kind, "success");
      assert.equal(effectCount(f.root), 1);

      // Fresh process: new store loaded from the durable ledger, new executor.
      const store2 = new ApprovalStore(f.root, { eventLog: f.log });
      await store2.load();
      const executor2 = createToolExecutor({ config: f.config, log: f.log, root: f.root, approvalStore: store2 });
      const replay = await executor2.execute(request);
      assert.equal(replay.kind, "denied");
      assert.equal(effectCount(f.root), 1, "fresh-process replay must not re-run the effect");
    } finally {
      f.cleanup();
    }
  });

  it("runs the effect exactly once under concurrent duplicate execution", async () => {
    const f = await makeFixture("concurrent");
    try {
      const request = shellRequest();
      await askAndApprove(f, request);
      const results = await Promise.all([f.executor.execute(request), f.executor.execute(request)]);
      const successes = results.filter(r => r.kind === "success").length;
      assert.equal(successes, 1, "exactly one concurrent execution may win the claim");
      assert.equal(effectCount(f.root), 1);
    } finally {
      f.cleanup();
    }
  });

  it("a changed argument set does not reuse the approval", async () => {
    const f = await makeFixture("args");
    try {
      const request = shellRequest();
      await askAndApprove(f, request);
      const changed = await f.executor.execute({ ...request, args: { command: OTHER_CMD } });
      assert.equal(changed.kind, "denied");
      assert.match((changed as { reason: string }).reason, /Approval required/i);
      assert.equal(effectCount(f.root), 0, "a mismatched invocation must never run");
    } finally {
      f.cleanup();
    }
  });

  it("a changed capability does not reuse the approval", async () => {
    const f = await makeFixture("capability");
    try {
      const request = shellRequest();
      await askAndApprove(f, request);
      const changed = await f.executor.execute({ ...request, name: "file.read", args: { path: "x.txt" } });
      assert.equal(changed.kind, "denied");
      assert.equal(effectCount(f.root), 0);
    } finally {
      f.cleanup();
    }
  });

  it("a changed agent identity does not reuse the approval", async () => {
    const f = await makeFixture("agent");
    try {
      const request = shellRequest({ agentId: "agent-one" });
      await askAndApprove(f, request);
      const changed = await f.executor.execute({ ...request, agentId: "agent-two" });
      assert.equal(changed.kind, "denied");
      assert.equal(effectCount(f.root), 0);
    } finally {
      f.cleanup();
    }
  });

  it("a legacy approved record with no invocation binding is re-asked, never reused", async () => {
    const f = await makeFixture("legacy");
    try {
      const request = shellRequest();
      // Legacy record: created directly with no invocation fingerprint.
      const legacy = await f.store.request({
        reason: "legacy fixture",
        capability: "shell.run",
        sessionId: "test",
        agentId: "agent-one",
        requestId: request.toolCallId,
      });
      await f.store.resolve(legacy.id, "approved", "legacy fixture");

      const result = await f.executor.execute(request);
      assert.equal(result.kind, "denied");
      assert.match((result as { reason: string }).reason, /Approval required/i);
      assert.equal(effectCount(f.root), 0, "an unbound legacy record must never authorize");
      // The gate must have minted a fresh, bound approval rather than reusing it.
      const fresh = f.store.findByRequestId(request.toolCallId);
      assert.ok(fresh && fresh.id !== legacy.id, "a new approval record must be created");
    } finally {
      f.cleanup();
    }
  });

  it("a consumed record is denied and never re-authorized", async () => {
    const f = await makeFixture("consumed");
    try {
      const request = shellRequest();
      await askAndApprove(f, request);
      assert.equal((await f.executor.execute(request)).kind, "success");
      const replay = await f.executor.execute(request);
      assert.equal(replay.kind, "denied");
      assert.match((replay as { reason: string }).reason, /already consumed|already executed/i);
      assert.equal(effectCount(f.root), 1);
    } finally {
      f.cleanup();
    }
  });

  it("the store refuses a second consume of the same approval", async () => {
    const f = await makeFixture("double-consume");
    try {
      const rec = await f.store.request({ reason: "t", capability: "shell.run", sessionId: "test" });
      await f.store.resolve(rec.id, "approved", "t");
      const first = await f.store.consumeApproved(rec.id, rec.bindingKey, {});
      const second = await f.store.consumeApproved(rec.id, rec.bindingKey, {});
      assert.equal(first.consumed, true);
      assert.equal(second.consumed, false);
      assert.equal(f.store.get(rec.id)?.status, "consumed");
    } finally {
      f.cleanup();
    }
  });
});

describe("legacy approval single-use (continuation-resume route)", () => {
  it("resumes exactly once and the continuation is one-shot", async () => {
    const f = await makeFixture("cont-once");
    try {
      const request = shellRequest();
      const approvalId = await askAndApprove(f, request);
      await persistContinuation(f, approvalId, request);
      const manager = await makeContinuationManager(f);

      const first = await manager.resumeApproved(approvalId);
      assert.equal(first.resumed, true, first.error ?? "resume failed");
      assert.equal(effectCount(f.root), 1);

      const second = await manager.resumeApproved(approvalId);
      assert.equal(second.resumed, false);
      assert.equal(effectCount(f.root), 1, "a removed continuation cannot replay the effect");
    } finally {
      f.cleanup();
    }
  });

  it("resumes the effect exactly once under concurrent resumes", async () => {
    const f = await makeFixture("cont-concurrent");
    try {
      const request = shellRequest();
      const approvalId = await askAndApprove(f, request);
      await persistContinuation(f, approvalId, request);
      const manager = await makeContinuationManager(f);

      const results = await Promise.allSettled([
        manager.resumeApproved(approvalId),
        manager.resumeApproved(approvalId),
      ]);
      const resumed = results.filter(
        r => r.status === "fulfilled" && r.value.resumed === true,
      ).length;
      assert.equal(resumed, 1, "exactly one concurrent resume may execute");
      assert.equal(effectCount(f.root), 1);
    } finally {
      f.cleanup();
    }
  });

  it("refuses to resume a legacy approval with no invocation binding", async () => {
    const f = await makeFixture("cont-legacy");
    try {
      const request = shellRequest();
      const legacy = await f.store.request({
        reason: "legacy continuation",
        capability: "shell.run",
        sessionId: "test",
        agentId: "agent-one",
      });
      await f.store.resolve(legacy.id, "approved", "legacy continuation");
      await persistContinuation(f, legacy.id, request);
      const manager = await makeContinuationManager(f);

      const result = await manager.resumeApproved(legacy.id);
      assert.equal(result.resumed, false);
      assert.equal(effectCount(f.root), 0, "an unbound legacy approval must not authorize a resume");
    } finally {
      f.cleanup();
    }
  });
});
