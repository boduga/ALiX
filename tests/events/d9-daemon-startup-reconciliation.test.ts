import { it } from "node:test";
import assert from "node:assert/strict";
import { CoordinationSchedulerService } from "../../src/operations/daemon/coordination-scheduler-service.js";
import type { CoordinationScheduler } from "../../src/coordination/kernel/coordination-scheduler.js";
import type { CoordinationStore } from "../../src/coordination/kernel/coordination-store.js";

it("D9 daemon startup reconciles terminal hosted runs without dispatching workers", async () => {
  const reconciled: string[] = [];
  let dispatches = 0;
  const scheduler = {
    reconcileTerminalCompletion: async (id: string) => { reconciled.push(id); },
    tick: async () => { dispatches++; },
    shutdown: async () => {},
  } as unknown as CoordinationScheduler;
  const runs = [
    { id: "complete", status: "completed", hostKind: "daemon" },
    { id: "failed", status: "failed", hostKind: "daemon" },
    { id: "running", status: "running", hostKind: "daemon" },
    { id: "other-host", status: "completed", hostKind: "inspector" },
  ];
  const store = { list: async () => runs } as unknown as CoordinationStore;
  const service = new CoordinationSchedulerService(scheduler, store, { hostKind: "daemon", pollIntervalMs: 60_000 });
  try {
    service.start();
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error("startup reconciliation timeout")), 2000);
      const check = () => { if (reconciled.length === 2) { clearTimeout(deadline); resolve(); } else setTimeout(check, 5); };
      check();
    });
    assert.deepEqual(reconciled, ["complete", "failed"]);
    assert.equal(dispatches, 0);
  } finally { service.stop(); }
});
