/**
 * P5.2b.1 — Windowed MetricsSnapshot tests.
 *
 * Verifies `computeMetricsSnapshot`:
 *  - returns identical all-time metrics when no window is provided
 *    (behavior-preserving extraction from ReflectionAgent.computeMetrics);
 *  - honors an `after` window (only records with timestamp > after counted);
 *  - returns the empty/default metrics shape for a windowed-out store.
 *
 * This is the foundation for P5.2b before/after effectiveness measurement.
 *
 * Note on record insertion: EvidenceStore.appendBatch() overwrites the
 * timestamp with `now()`, which makes it unusable for window tests. We instead
 * write fully-formed EvidenceRecord lines directly to `evidence.jsonl`. The
 * store's `query()` reads these via JSON.parse without re-verifying the
 * fingerprint, so controlled historical timestamps are honored.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EvidenceStore } from "../../src/security/evidence/evidence-store.js";
import { computeMetricsSnapshot } from "../../src/reflection/metrics-snapshot.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let n = 0;
/**
 * Append a minimal valid EvidenceRecord line with a CONTROLLED timestamp to the
 * store's JSONL file. The fingerprint is not verified on query(), so a stable
 * placeholder is sufficient; `version` must match the schema the store reads.
 */
function appendRecord(
  dir: string,
  type: string,
  ts: string,
  payload: Record<string, unknown>,
): void {
  n += 1;
  const record = {
    version: 1,
    id: `${type}-${n}`,
    type,
    timestamp: ts,
    fingerprint: `fp-${n}`,
    payload,
  };
  appendFileSync(join(dir, "evidence.jsonl"), JSON.stringify(record) + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeMetricsSnapshot", () => {
  let dir: string;
  let store: EvidenceStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "metrics-snapshot-"));
    store = new EvidenceStore({ storeDir: dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("counts all-time metrics when no window is given", async () => {
    appendRecord(dir, "merge_completed", "2026-06-01T00:00:00Z", {});
    appendRecord(dir, "merge_completed", "2026-06-02T00:00:00Z", {});
    appendRecord(dir, "workflow_blocked", "2026-06-01T00:00:00Z", {});
    appendRecord(dir, "capability_routed", "2026-06-01T00:00:00Z", { candidates: 3 });
    appendRecord(dir, "capability_routed", "2026-06-02T00:00:00Z", { candidates: 0 });
    appendRecord(dir, "review_completed", "2026-06-01T00:00:00Z", { verdict: "approve" });
    appendRecord(dir, "review_completed", "2026-06-02T00:00:00Z", { verdict: "reject" });

    const m = await computeMetricsSnapshot(store);

    expect(m.workflowsCompleted).toBe(2);
    expect(m.workflowsBlocked).toBe(1);
    expect(m.workflowsAborted).toBe(0);
    expect(m.capabilitiesRequested).toBe(2);
    expect(m.unresolvedCapabilities).toBe(1); // one routed with candidates === 0
    expect(m.reviewApprovalRate).toBeCloseTo(0.5); // 1 approve / 2 total
  });

  it("honors an `after` window — only records with timestamp > after are counted", async () => {
    // before the window (filtered out by timestamp > after)
    appendRecord(dir, "merge_completed", "2026-05-01T00:00:00Z", {});
    appendRecord(dir, "review_completed", "2026-05-01T00:00:00Z", { verdict: "approve" });
    // inside the window (timestamp strictly greater than the after boundary)
    appendRecord(dir, "merge_completed", "2026-06-02T00:00:00Z", {});
    appendRecord(dir, "merge_completed", "2026-06-03T00:00:00Z", {});
    appendRecord(dir, "review_completed", "2026-06-02T00:00:00Z", { verdict: "reject" });

    const m = await computeMetricsSnapshot(store, { after: "2026-06-01T00:00:00Z" });

    expect(m.workflowsCompleted).toBe(2); // the two June merges
    expect(m.workflowsBlocked).toBe(0);
    expect(m.reviewApprovalRate).toBe(0); // 0 approve / 1 total
  });

  it("returns the empty/default metrics for a windowed-out store", async () => {
    // all records fall before the after-window → nothing counted
    appendRecord(dir, "merge_completed", "2026-05-01T00:00:00Z", {});
    appendRecord(dir, "review_completed", "2026-05-01T00:00:00Z", { verdict: "approve" });

    const m = await computeMetricsSnapshot(store, { after: "2026-06-01T00:00:00Z" });

    expect(m.workflowsCompleted).toBe(0);
    expect(m.reviewApprovalRate).toBe(1); // no reviews → default 1
  });
});
