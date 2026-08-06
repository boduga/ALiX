/**
 * #409 — Evidence persistence + restart recovery through the governed path.
 *
 * Proves that evidence emitted by a governed execution persists durably to
 * the X3b append-only store (via PersistenceEvidenceEmitter) and that
 * recoverExecutionState reconstructs completed vs in-flight executions from
 * that evidence. Also pins the non-blocking guarantee: a store failure never
 * stalls the execution path.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executeRouteGoverned } from "../../src/runtime/governed-route-executor.js";
import {
  PersistenceEvidenceEmitter,
  recoverExecutionState,
} from "../../src/runtime/execution-persistence.js";
import { ExecutionEvidenceStore } from "../../src/runtime/execution-evidence-store.js";
import { ExecutionState } from "../../src/runtime/contracts/execution-runtime-contract.js";
import type { ExecutionEvidenceEmitter } from "../../src/runtime/contracts/execution-runtime-contract.js";
import type { RuntimeContext, RuntimeExecutor } from "../../src/runtime/route-executor.js";
import { taskRouter, type TaskRoute } from "../../src/runtime/task-router.js";

function makeCtx(): RuntimeContext {
  return {
    cwd: "/tmp",
    sessionId: "test",
    sessionDir: "/tmp/.alix/sessions/test",
    eventLog: {} as any,
    config: { model: { provider: "mock", name: "mock-model" } } as any,
  };
}

const fakeExecutor: RuntimeExecutor = {
  executeDirect: async (r) => `direct:${r.prompt}`,
  executeTool: async (r) => `tool:${r.tool}`,
  executeChat: async (r) => `chat:${r.prompt}`,
  executeGroundedChat: async (r) => `grounded:${r.prompt}`,
  executeAgent: async (r) => `agent:${r.task}`,
};

function withTempStore(
  fn: (dir: string, store: ExecutionEvidenceStore) => Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "governed-evidence-"));
  const store = new ExecutionEvidenceStore(dir);
  return fn(dir, store).finally(() => {
    rmSync(dir, { recursive: true, force: true });
  });
}

const flush = () => new Promise((r) => setTimeout(r, 50));

describe("governed execution — durable evidence persistence (X3b)", () => {
  it("persists every evidence record to the append-only store, each referencing one intentId", async () => {
    await withTempStore(async (_dir, store) => {
      const route = await taskRouter("2 + 2");
      assert.equal(route.kind, "direct");

      const out = await executeRouteGoverned(route, makeCtx(), fakeExecutor, {
        emitter: new PersistenceEvidenceEmitter(store),
      });
      await flush();

      const all = await store.list();
      // 5 machine transitions + the governor's hashed COMPLETED terminal = 6.
      assert.equal(all.length, 6, `expected 6 evidence records, got ${all.length}`);
      for (const r of all) {
        assert.equal(r.intentId, out.intentId, "every record references exactly one intentId");
      }
      // Append order preserved: the governor's terminal SUCCESS evidence is
      // the last record and carries a proper evidenceHash.
      const terminal = all[all.length - 1];
      assert.equal(terminal.outcome, "SUCCESS");
      assert.match(terminal.evidenceHash, /^[0-9a-f]{64}$/);
    });
  });

  it("recoverExecutionState reconstructs the completed execution as SUCCEEDED", async () => {
    await withTempStore(async (_dir, store) => {
      const route = await taskRouter("2 + 2");
      const out = await executeRouteGoverned(route, makeCtx(), fakeExecutor, {
        emitter: new PersistenceEvidenceEmitter(store),
      });
      await flush();

      const result = await recoverExecutionState(store);
      assert.equal(result.totalEvidence, 6);
      assert.deepEqual(result.intents, [out.intentId]);
      assert.equal(result.inFlight.length, 0);
      assert.equal(result.completed.length, 1);
      assert.equal(result.completed[0].intentId, out.intentId);
      assert.equal(result.completed[0].state, ExecutionState.SUCCEEDED);
      assert.equal(result.completed[0].isTerminal, true);
    });
  });

  it("evidence persistence is non-blocking — a store failure never stalls execution", async () => {
    const throwingEmitter: ExecutionEvidenceEmitter = {
      emit: () => {
        throw new Error("store down");
      },
    };
    const route: TaskRoute = {
      kind: "direct",
      prompt: "2 + 2",
      answer: "4",
      diagnostic: { classification: "arithmetic", route: "direct", reason: "pure arithmetic" },
    };
    const out = await executeRouteGoverned(route, makeCtx(), fakeExecutor, {
      emitter: throwingEmitter,
    });
    // Execution completed despite the failing persistence layer.
    assert.equal(out.result, "direct:2 + 2");
    assert.equal(out.finalState, ExecutionState.SUCCEEDED);
  });
});
