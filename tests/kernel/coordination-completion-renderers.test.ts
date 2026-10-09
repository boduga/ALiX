/**
 * coordination-completion-renderers.test.ts — C5: readers show the four
 * completion dimensions separately.
 *
 * `Status: completed` must never be the only thing a reader sees, because it
 * implies neither aggregation, nor a success outcome, nor verification. These
 * tests pin the derived label and dimensions in the shared view (which the CLI,
 * TUI and Inspector all read), the TUI panel, and the coordination tools.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CoordinationStore } from "../../src/coordination/kernel/coordination-store.js";
import { buildCoordinationRunView } from "../../src/coordination/kernel/coordination-view.js";
import { createCoordinationRun, createWorkerAssignment } from "../../src/coordination/kernel/coordination-types.js";
import { formatCoordinationPanel } from "../../src/interfaces/tui/coordination-panel.js";
import { createCoordinationHandlers, COORDINATION_STATUS_TOOL } from "../../src/coordination/kernel/coordination-tools.js";

function testConfig() {
  return {
    version: 1 as const,
    model: { provider: "test", name: "test" },
    permissions: { default: "allow" as const, tools: {}, protectedPaths: [], allowNetworkDomains: [], denyCommands: [], sessionMode: "bypass" as const },
    context: { repoMap: false, repoMapMode: "lite" as const, maxRepoMapTokens: 1000, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] },
    runtime: { provider: "process" as const, shell: "/bin/bash", commandTimeoutMs: 5000, envAllowlist: [] },
    ui: { enabled: false, host: "localhost", port: 0, transport: "sse" as const },
  };
}

describe("completion rendering", () => {
  let cwd: string;
  let store: CoordinationStore;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "coord-render-"));
    store = new CoordinationStore(cwd);
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  /** A terminal run with one completed worker; optionally record its events. */
  async function completedRun(runId: string, sessionId: string, events: Array<Record<string, unknown>> = []) {
    const run = createCoordinationRun({ sessionId, rootGoal: "produce the report", coordinatorAgentId: "alix" });
    run.id = runId;
    await store.save(run);
    const worker = createWorkerAssignment({
      coordinationRunId: run.id, agentId: "alix#1", taskLabel: "report", goalPrompt: "write it",
      ownershipScopes: [".tmp/out/report.md"], requiredCapabilities: ["task.do"], attempt: 0, maxAttempts: 3,
    });
    await store.addWorker(run.id, worker);
    await store.patchWorker(run.id, worker.id, { status: "completed" });
    await store.updateRun(run.id, (current) => { current.status = "completed"; });
    if (events.length > 0) {
      const dir = join(cwd, ".alix", "sessions", sessionId);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "events.jsonl"), events.map(e => JSON.stringify(e)).join("\n"), "utf8");
    }
    return store.load(runId);
  }

  it("reports a legacy completed run as unaggregated, not as a verified success", async () => {
    await completedRun("coord_legacy", "sess_legacy");
    const view = await buildCoordinationRunView("coord_legacy", cwd);

    assert.equal(view?.run.status, "completed", "the legacy status stays visible");
    assert.deepEqual(view?.run.completion, {
      execution: "completed",
      aggregation: "pending",
      outcome: "unknown",
      verification: "unverified",
    });
    assert.equal(view?.run.completionLabel, "workers finished; results not aggregated");
  });

  it("reports verified completion only when the aggregate event matches", async () => {
    await completedRun("coord_ok", "sess_ok");
    const ref = ".alix/coordination/results/runs/coord_ok.json";
    const fingerprint = "fp-1";
    await store.attachAggregate("coord_ok", {
      aggregateResultRef: ref, aggregateGeneratedAt: "2026-09-29T00:00:00.000Z",
      aggregateSourceFingerprint: fingerprint, outcome: "success",
    });
    // Without the event: aggregate attached, still unverified.
    const before = await buildCoordinationRunView("coord_ok", cwd);
    assert.equal(before?.run.completion.aggregation, "generated");
    assert.equal(before?.run.completion.verification, "unverified");
    assert.equal(before?.run.completionLabel, "completed; not verified");

    // Record the matching completion event.
    const dir = join(cwd, ".alix", "sessions", "sess_ok");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "events.jsonl"),
      JSON.stringify({
        type: "coordination.aggregate.completed",
        payload: { runId: "coord_ok", aggregateResultRef: ref, sourceFingerprint: fingerprint, outcome: "success" },
      }),
      "utf8",
    );
    const after = await buildCoordinationRunView("coord_ok", cwd);
    assert.equal(after?.run.completion.verification, "verified");
    assert.equal(after?.run.completionLabel, "verified completion");
  });

  it("does not verify from a mismatched aggregate event", async () => {
    await completedRun("coord_stale", "sess_stale");
    await store.attachAggregate("coord_stale", {
      aggregateResultRef: ".alix/coordination/results/runs/coord_stale.json",
      aggregateGeneratedAt: "2026-09-29T00:00:00.000Z",
      aggregateSourceFingerprint: "fp-current",
      outcome: "success",
    });
    const dir = join(cwd, ".alix", "sessions", "sess_stale");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "events.jsonl"),
      JSON.stringify({
        type: "coordination.aggregate.completed",
        payload: { runId: "coord_stale", aggregateResultRef: "old.json", sourceFingerprint: "fp-old" },
      }),
      "utf8",
    );
    const view = await buildCoordinationRunView("coord_stale", cwd);
    assert.equal(view?.run.completion.verification, "unverified", "an older event must not verify");
  });

  it("shows the derived completion in the TUI panel next to the legacy status", async () => {
    await completedRun("coord_panel", "sess_panel", [
      { type: "coordination.worker.completed", payload: { coordinationRunId: "coord_panel", workerId: "w1" } },
    ]);
    const view = await buildCoordinationRunView("coord_panel", cwd);
    const panel = formatCoordinationPanel({ view: view!, viewMode: "overview", selectedWorkerIndex: 0 }).join("\n");

    assert.match(panel, /Status: completed/);
    assert.match(panel, /Completion: workers finished; results not aggregated/);
    assert.match(panel, /execution=completed aggregation=pending outcome=unknown verification=unverified/);
  });

  it("shows the derived completion in coordination.status output", async () => {
    await completedRun("coord_tool", "sess_tool");
    const handlers = createCoordinationHandlers({ cwd, config: testConfig() as never, store });
    const result = await handlers[COORDINATION_STATUS_TOOL]({ runId: "coord_tool" });
    assert.equal(result.kind, "success");
    const output = result.kind === "success" ? String(result.output ?? "") : "";

    assert.match(output, /Status: completed/);
    assert.match(output, /Completion: workers finished; results not aggregated/);
    assert.match(output, /aggregation=pending/);
    assert.match(output, /verification=unverified/);
  });
});
