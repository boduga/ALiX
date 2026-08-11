// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlCapabilityLifecycleLedger } from "../../../src/evolution/capability-lifecycle/capability-lifecycle-ledger.js";
import { CapabilityLifecycleMeasurer } from "../../../src/evolution/capability-lifecycle/capability-lifecycle-measurer.js";
import { CapabilityEvolutionStore } from "../../../src/adaptation/capability-evolution-store.js";
import type { CapabilityEvolutionReport, CapabilityHealth } from "../../../src/adaptation/capability-evolution-types.js";

function health(capability: string, lifecycleState: string): CapabilityHealth {
  return { capability, agentCount: 0, resolutionCount: 2, resolutionCountRecent: 0,
    resolutionCountPrior: 1, proposalCountRecent: 0, proposalCountPrior: 2, demandScore: 0.1,
    keepRate: 0.2, revertRate: 0.4, proposalCount: 2, lifecycleState: lifecycleState as never, rationale: "r" };
}

let dir: string;
let ledger: JsonlCapabilityLifecycleLedger;
let store: CapabilityEvolutionStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "a7-measurer-"));
  ledger = new JsonlCapabilityLifecycleLedger(join(dir, "lifecycle.jsonl"));
  store = new CapabilityEvolutionStore(join(dir, "evolution"));
});

afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("CapabilityLifecycleMeasurer", () => {
  it("measures a capability with an applied record → measured with measurementId + refs", async () => {
    await ledger.append({ target: { capabilityId: "core.old" }, intent: "deprecate", eventType: "applied",
      timestamp: new Date().toISOString(), decisionId: "govd-abc", executionId: "a7-exec-x",
      evidenceRefs: [], observedLifecycleState: "declining", proposedLifecycleState: "deprecated" });
    await store.save({
      generatedAt: new Date().toISOString(), totalCapabilities: 1,
      healthAnalysis: [health("core.old", "deprecated")], gapAnalysis: [], overlapAnalysis: [],
      driftAnalysis: [], lifecycleDistribution: { emerging: 0, active: 0, mature: 0, stagnant: 0, declining: 1, deprecated: 1 },
      executiveSummary: "s",
    });

    const measurer = new CapabilityLifecycleMeasurer({ ledger, store });
    const res = await measurer.measure("core.old");
    assert.equal(res.status, "measured");
    assert.match(res.measurementId, /^a7-meas-/);
    const latest = await ledger.listLatestForCapability("core.old");
    assert.equal(latest?.eventType, "measured");
    assert.ok(latest?.measurementId);
    assert.ok(latest?.baselineEvidenceRefs);
    assert.ok(latest?.postObservationRefs);
    assert.match(res.stateTransition, /declining → deprecated/);
  });

  it("no applied record → blocked, no write", async () => {
    const measurer = new CapabilityLifecycleMeasurer({ ledger, store });
    const res = await measurer.measure("core.old");
    assert.equal(res.status, "blocked");
    assert.match(res.reason, /No applied/);
    assert.equal((await ledger.list()).length, 0);
  });
});
