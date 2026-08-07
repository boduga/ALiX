/**
 * Governed runTask evidence (spec #404).
 *
 * The exported `runTask` wraps the agent-loop core with the ExecutionIntent
 * lifecycle, emitting terminal evidence to the X3b store. This test pins the
 * testable unit (`emitRunEvidence`) — a fire-and-forget, never-throwing
 * evidence writer — against a real ExecutionEvidenceStore.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { emitRunEvidence } from "../../src/agent/agent-loop.js";
import { PersistenceEvidenceEmitter } from "../../src/runtime/execution-persistence.js";
import { ExecutionEvidenceStore } from "../../src/runtime/execution-evidence-store.js";

function withStore(fn: (store: ExecutionEvidenceStore) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "run-evidence-"));
  return fn(new ExecutionEvidenceStore(dir)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

describe("emitRunEvidence — governed runTask evidence", () => {
  it("writes a SUCCESS evidence record keyed by the intentId", async () => {
    await withStore(async (store) => {
      const emitter = new PersistenceEvidenceEmitter(store);
      emitRunEvidence("intent-abc", "ExecutionCompleted", "SUCCESS", "done", emitter, "2026-08-07T00:00:00.000Z");
      await new Promise((r) => setTimeout(r, 60));
      const all = await store.list();
      expect(all).toHaveLength(1);
      expect(all[0]!.intentId).toBe("intent-abc");
      expect(all[0]!.outcome).toBe("SUCCESS");
      expect(all[0]!.verificationPassed).toBe(true);
    });
  });

  it("writes a FAILED evidence record when the run fails", async () => {
    await withStore(async (store) => {
      const emitter = new PersistenceEvidenceEmitter(store);
      emitRunEvidence("intent-abc", "ExecutionFailed", "FAILED", "boom", emitter, "2026-08-07T00:00:00.000Z");
      await new Promise((r) => setTimeout(r, 60));
      const all = await store.list();
      expect(all).toHaveLength(1);
      expect(all[0]!.outcome).toBe("FAILED");
      expect(all[0]!.verificationPassed).toBe(false);
    });
  });

  it("never throws when the emitter fails (fire-and-forget)", () => {
    const throwing = { emit: () => { throw new Error("store down"); } };
    expect(() =>
      emitRunEvidence("intent-abc", "ExecutionCreated", "SUCCESS", "s", throwing, "2026-08-07T00:00:00.000Z"),
    ).not.toThrow();
  });
});
