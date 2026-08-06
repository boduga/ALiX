/**
 * #410 — Direct fast-path governed; session-domain separation.
 *
 * Pins that a direct route produces an ExecutionIntent + CREATED/APPROVED
 * lifecycle evidence while never creating an agent session, a TaskRegistry
 * entry, or a `.alix/sessions` / `.alix/plans` record. Lifecycle evidence
 * and session records live in SEPARATE stores — writing one never writes
 * the other. The direct path's fast-path behavior is unchanged.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executeRouteGoverned, governDirectRoute } from "../../src/runtime/governed-route-executor.js";
import { PersistenceEvidenceEmitter } from "../../src/runtime/execution-persistence.js";
import { ExecutionEvidenceStore } from "../../src/runtime/execution-evidence-store.js";
import { ExecutionState } from "../../src/runtime/contracts/execution-runtime-contract.js";
import type { RuntimeContext, RuntimeExecutor } from "../../src/runtime/route-executor.js";
import type { TaskRoute } from "../../src/runtime/task-router.js";

const ARITHMETIC_ROUTE: TaskRoute = {
  kind: "direct",
  prompt: "2 + 2",
  answer: "4",
  diagnostic: { classification: "arithmetic", route: "direct", reason: "pure arithmetic" },
};

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
  executeDirect: async (r) => (r.answer !== undefined ? r.answer : `direct:${r.prompt}`),
  executeTool: async (r) => `tool:${r.tool}`,
  executeChat: async (r) => `chat:${r.prompt}`,
  executeGroundedChat: async (r) => `grounded:${r.prompt}`,
  executeAgent: async (r) => `agent:${r.task}`,
};

const flush = () => new Promise((r) => setTimeout(r, 50));

describe("governed direct path — session-domain separation", () => {
  it("produces intent + CREATED/APPROVED evidence and touches NO session/registry/session dirs", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "governed-direct-"));
    const alixDir = join(tmp, ".alix");
    const evidenceDir = join(tmp, "evidence");
    mkdirSync(alixDir, { recursive: true });
    try {
      // Only the config exists — NO `.alix/sessions`, NO `.alix/plans`.
      writeFileSync(join(alixDir, "config.json"), JSON.stringify({ model: { provider: "mock", name: "mock" } }));

      const store = new ExecutionEvidenceStore(evidenceDir);
      const out = await executeRouteGoverned(ARITHMETIC_ROUTE, makeCtx(), fakeExecutor, {
        emitter: new PersistenceEvidenceEmitter(store),
      });
      await flush();

      // 1. Direct route produced an intent + CREATED/APPROVED lifecycle evidence.
      assert.equal(out.intent.action, "arithmetic");
      assert.equal(out.finalState, ExecutionState.SUCCEEDED);
      const persisted = await store.list();
      assert.equal(persisted.length, 6, "full lifecycle evidence persisted (5 machine + 1 hashed governor terminal)");
      assert.ok(persisted.some((e) => e.outcome === "SUCCESS"));

      // 2. No session-domain artifacts were created in the cwd.
      const entries = readdirSync(alixDir);
      assert.ok(!entries.includes("sessions"), ".alix/sessions must not be created");
      assert.ok(!entries.includes("plans"), ".alix/plans must not be created");
      assert.ok(!existsSync(join(alixDir, "daemon-tasks.json")), "no TaskRegistry file created");

      // 3. Lifecycle evidence lives in its own store, separate from session records.
      assert.ok(existsSync(join(evidenceDir, "execution-evidence.jsonl")), "evidence in its own store");
      assert.ok(!existsSync(join(evidenceDir, "..", ".alix", "sessions")), "session dir not in evidence store path");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("governDirectRoute runs the direct answer and emits evidence without a RuntimeContext", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "governed-direct-helper-"));
    mkdirSync(join(tmp, ".alix"), { recursive: true });
    writeFileSync(join(tmp, ".alix", "config.json"), JSON.stringify({ model: { provider: "mock", name: "mock" } }));
    const evidenceDir = join(tmp, "evidence");
    try {
      const store = new ExecutionEvidenceStore(evidenceDir);
      const out = await governDirectRoute(ARITHMETIC_ROUTE, tmp, {
        emitter: new PersistenceEvidenceEmitter(store),
      });
      await flush();

      assert.equal(out.result, "4");
      assert.equal(out.intent.action, "arithmetic");
      assert.ok(out.evidence.length >= 6, "evidence includes machine + hashed governor terminal");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
