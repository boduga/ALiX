/**
 * P18 — `alix governance workbench trace` store wiring.
 *
 * The trace used to pass empty maps for signals, investigations and report
 * items, so every run rendered phantom gap hops for records that were on disk.
 * These tests seed the real stores and assert the hops resolve.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runWorkbenchTrace } from "../../../src/interfaces/cli/commands/governance/workbench.js";
import type { GovernanceSignal } from "../../../src/governance/governance-signal.js";
import type { InvestigationRecommendation } from "../../../src/governance/investigation-types.js";
import type { GovernanceRemediationProposal } from "../../../src/governance/remediation-queue.js";

const NOW = new Date().toISOString();

let cwdSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "gov-trace-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
});

afterEach(() => {
  cwdSpy.mockRestore();
  rmSync(tempRoot, { recursive: true, force: true });
});

function captureConsole(): { out: () => string[]; restore: () => void } {
  const out: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    out.push(a.join(" "));
  });
  return { out: () => out, restore: () => logSpy.mockRestore() };
}

// ---------------------------------------------------------------------------
// Seeding — written through the same stores the CLI reads
// ---------------------------------------------------------------------------

const REMEDIATION_ID = "prop-trace-001";

function makeRemediation(): GovernanceRemediationProposal {
  return {
    proposalId: REMEDIATION_ID,
    // The trace resolves the investigation by this id, then the signal by the
    // investigation's sourceArtifactId.
    sourceRecommendationIds: ["inv-trace-001"],
    title: "Revert rate anomaly",
    severity: "warning",
    windowStart: "2026-06-01T00:00:00.000Z",
    windowEnd: "2026-07-08T00:00:00.000Z",
    evidenceRefs: [],
    status: "accepted",
    createdAt: NOW,
    responseKind: "investigate_anomaly",
    proposedAction: "review",
    reversible: true,
  };
}

function makeSignal(): GovernanceSignal {
  return {
    signalId: "sig-trace-001",
    sourcePhase: "p13.1",
    signalType: "trend_alert",
    severity: "medium",
    confidence: 0.8,
    title: "Capability revert rate climbing",
    description: "Keep rate fell over the last 20 changes.",
    evidenceRefs: [
      { source: "failure-analysis", id: "fa-001", description: "Revert rate series." },
    ],
    recommendation: "Investigate the capability area.",
    metadata: {},
    status: "new",
    requestedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeInvestigation(): InvestigationRecommendation {
  return {
    id: "inv-trace-001",
    kind: "governance_integrity",
    status: "open",
    severity: "medium",
    source: "integrity",
    sourceArtifactId: "sig-trace-001",
    evidenceRefs: [],
    title: "Revert trend needs review",
    description: "Historical analog: similar change reverted last month.",
    operatorGuidance: "Review before applying.",
    createdAt: NOW,
  };
}

async function seedLifecycle(): Promise<void> {
  const { RemediationStore } = await import("../../../src/governance/remediation-store.js");
  const { FileSignalStore } = await import("../../../src/governance/governance-signal.js");
  const { InvestigationStore } = await import("../../../src/governance/investigation-store.js");

  await new RemediationStore(tempRoot).append(makeRemediation());
  await new FileSignalStore(tempRoot).append(makeSignal());
  await new InvestigationStore(join(tempRoot, ".alix", "governance")).save(makeInvestigation());
}

async function traceJson(remediationId: string): Promise<{
  hops: { kind: string; id: string; gap: boolean }[];
}> {
  const capture = captureConsole();
  try {
    await runWorkbenchTrace([remediationId, "--json"], true);
  } finally {
    capture.restore();
  }
  const raw = capture.out().join("\n");
  const start = raw.indexOf("{");
  expect(start).toBeGreaterThanOrEqual(0);
  const parsed = JSON.parse(raw.slice(start)) as {
    trace: { hops: { kind: string; id: string; gap: boolean }[] };
  };
  return parsed.trace;
}

function hop(trace: { hops: { kind: string }[] }, kind: string) {
  return trace.hops.find((h) => h.kind === kind);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("governance workbench trace — store wiring", () => {
  it("resolves signal and investigation hops from persisted stores", async () => {
    await seedLifecycle();

    const trace = await traceJson(REMEDIATION_ID);

    expect(hop(trace, "signal")).toMatchObject({ id: "sig-trace-001", gap: false });
    expect(hop(trace, "investigation")).toMatchObject({ id: "inv-trace-001", gap: false });
  });

  it("resolves the report hop from the derived execution report", async () => {
    await seedLifecycle();

    const trace = await traceJson(REMEDIATION_ID);

    expect(hop(trace, "report")).toMatchObject({ id: REMEDIATION_ID, gap: false });
  });

  it("resolves the originating-chain hops when the stores are populated", async () => {
    await seedLifecycle();

    const trace = await traceJson(REMEDIATION_ID);

    for (const kind of ["signal", "investigation", "proposal", "report"]) {
      expect(hop(trace, kind)).toMatchObject({ gap: false });
    }
  });

  it("still reports signal/investigation gaps when those stores hold nothing", async () => {
    const { RemediationStore } = await import("../../../src/governance/remediation-store.js");
    await new RemediationStore(tempRoot).append(makeRemediation());

    const trace = await traceJson(REMEDIATION_ID);

    expect(hop(trace, "signal")).toMatchObject({ gap: true });
    expect(hop(trace, "investigation")).toMatchObject({ gap: true });
  });
});