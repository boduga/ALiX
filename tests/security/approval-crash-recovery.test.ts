/**
 * approval-crash-recovery.test.ts — R1.5 crash-after-consume contract.
 *
 * Consumption and execution cannot be one transaction across a process
 * boundary, so a crash between them is a real state. The contract pinned here:
 *
 *  - a claim is durable and marks the record `executionOutcome: "pending"`;
 *  - a completed execution reports `succeeded` / `failed` / `cancelled`;
 *  - a replay that observes a `pending` claim classifies it `unverified` and
 *    DENIES — the side effect is unknown, so authority is never reissued and
 *    the invocation is never retried automatically;
 *  - uncertainty is listable for an operator without any wall-clock sweep.
 *
 * Every assertion reads real record state and real file effects, not just the
 * returned verdict.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createToolExecutor } from "../../src/capabilities/tools/tool-executor-factory.js";
import type { ToolExecutor } from "../../src/capabilities/tools/tool-executor-factory.js";
import { DEFAULT_CONFIG } from "../../src/operations/config/defaults.js";
import { ApprovalStore } from "../../src/governance/approvals/approval-store.js";
import { EventLog } from "../../src/runtime-state/events/event-log.js";
import { ContinuationStore } from "../../src/runtime-state/runtime/continuation-store.js";
import { ContinuationManager } from "../../src/runtime-state/runtime/continuation-manager.js";
import type { AlixConfig } from "../../src/operations/config/schema.js";

const EFFECT_CMD = "printf 'effect\\n' >> effects.txt";

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
  const root = mkdtempSync(join(tmpdir(), `alix-crash-${label}-`));
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

async function requestAndApprove(
  f: Fixture,
  overrides: { name?: string; args?: Record<string, unknown>; agentId?: string } = {},
) {
  const request = {
    toolCallId: overrides.name === "file.read" ? `read-${seq++}` : `call-${seq++}`,
    name: overrides.name ?? "shell.run",
    args: overrides.args ?? { command: EFFECT_CMD },
    agentId: overrides.agentId ?? "agent-one",
  };
  const first = await f.executor.execute(request);
  assert.equal(first.kind, "denied");
  const record = f.store.findByRequestId(request.toolCallId);
  assert.ok(record);
  await f.store.resolve(record.id, "approved", "crash-recovery fixture");
  return { request, record };
}

describe("approval crash-after-consume recovery", () => {
  it("marks a claimed-but-unreported approval unverified and denies the replay", async () => {
    const f = await makeFixture("unverified");
    try {
      const { request, record } = await requestAndApprove(f);

      // Simulate a crash: the claim committed, execution never reported back.
      const claim = await f.store.consumeApproved(record.id, record.bindingKey, {});
      assert.equal(claim.consumed, true);
      assert.equal(f.store.get(record.id)?.executionOutcome, "pending");

      const replay = await f.executor.execute(request);
      assert.equal(replay.kind, "denied");
      assert.match((replay as { reason: string }).reason, /UNVERIFIED|unknown/i);
      assert.equal(effectCount(f.root), 0, "an unverified claim must never execute");

      const after = f.store.get(record.id);
      assert.equal(after?.status, "consumed");
      assert.equal(after?.executionOutcome, "unverified", "replay must classify the dead claim");

      // A second replay is stable and equally denied.
      const again = await f.executor.execute(request);
      assert.equal(again.kind, "denied");
      assert.equal(effectCount(f.root), 0);
    } finally {
      f.cleanup();
    }
  });

  it("reports a proven success and still refuses a replay", async () => {
    const f = await makeFixture("success");
    try {
      const { request, record } = await requestAndApprove(f);
      const run = await f.executor.execute(request);
      assert.equal(run.kind, "success");
      assert.equal(effectCount(f.root), 1);
      assert.equal(f.store.get(record.id)?.executionOutcome, "succeeded");

      const replay = await f.executor.execute(request);
      assert.equal(replay.kind, "denied");
      assert.match((replay as { reason: string }).reason, /already executed successfully/i);
      assert.equal(effectCount(f.root), 1);
    } finally {
      f.cleanup();
    }
  });

  it("reports a proven failure and still refuses a replay", async () => {
    const f = await makeFixture("failure");
    try {
      const { request, record } = await requestAndApprove(f, {
        name: "file.read",
        args: { path: "does-not-exist.txt" },
      });
      const run = await f.executor.execute(request);
      assert.equal(run.kind, "error");
      assert.equal(f.store.get(record.id)?.executionOutcome, "failed");

      const replay = await f.executor.execute(request);
      assert.equal(replay.kind, "denied");
      assert.match((replay as { reason: string }).reason, /execution already failed/i);
    } finally {
      f.cleanup();
    }
  });

  it("lists uncertain consumptions without a wall-clock sweep", async () => {
    const f = await makeFixture("list");
    try {
      const { record } = await requestAndApprove(f);
      await f.store.consumeApproved(record.id, record.bindingKey, {});

      const pendingList = f.store.listUncertainConsumptions();
      assert.equal(pendingList.length, 1);
      assert.equal(pendingList[0].id, record.id);
      assert.equal(pendingList[0].executionOutcome, "pending");

      assert.equal(await f.store.markExecutionUnverified(record.id), "unverified");
      const after = f.store.listUncertainConsumptions();
      assert.equal(after.length, 1);
      assert.equal(after[0].executionOutcome, "unverified");

      // Idempotent: a second classification does not mint a new state.
      assert.equal(await f.store.markExecutionUnverified(record.id), "unverified");

      // A resolved claim is no longer uncertain.
      const other = await requestAndApprove(f);
      assert.equal((await f.executor.execute(other.request)).kind, "success");
      assert.equal(
        f.store.listUncertainConsumptions().some(r => r.id === other.record.id),
        false,
      );
    } finally {
      f.cleanup();
    }
  });

  it("does not let a duplicate outcome report rewrite a resolved claim", async () => {
    const f = await makeFixture("dup");
    try {
      const { request, record } = await requestAndApprove(f);
      assert.equal((await f.executor.execute(request)).kind, "success");
      assert.equal(f.store.get(record.id)?.executionOutcome, "succeeded");

      const overwrite = await f.store.recordExecutionOutcome(record.id, "failed");
      assert.equal(overwrite, false, "first terminal transition wins");
      assert.equal(f.store.get(record.id)?.executionOutcome, "succeeded");
    } finally {
      f.cleanup();
    }
  });

  it("classifies a crashed claim at the continuation seam too", async () => {
    const f = await makeFixture("cont-crash");
    try {
      const { record } = await requestAndApprove(f);
      await f.store.consumeApproved(record.id, record.bindingKey, {});

      const cs = new ContinuationStore(f.root);
      await cs.load();
      const manager = new ContinuationManager({
        approvalStore: f.store,
        continuationStore: cs,
        eventLog: f.log,
        executeTool: (call) => f.executor.execute(call as never),
      });

      const result = await manager.resumeApproved(record.id);
      assert.equal(result.resumed, false);
      assert.match(result.error ?? "", /UNVERIFIED/i);
      assert.equal(effectCount(f.root), 0);
      assert.equal(f.store.get(record.id)?.executionOutcome, "unverified");
    } finally {
      f.cleanup();
    }
  });
});
