/**
 * A9 Slice 5 — composition-root wiring test (Phase 18, CAP-12 carve-out).
 *
 * The CapabilityPlatform composition root constructs the A9 adapters +
 * engines (exposed as `platform.a9`) bound to the SAME EventLog the platform
 * received (ruling #12) and the A9-owned governance JSONL stores. A9 modules
 * never instantiate EventLog / global infra themselves.
 *
 * @module a9-composition-root
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityPlatform } from "../../src/capability/platform.js";
import { EventLog } from "../../src/events/event-log.js";
import { ForecastsStore } from "../../src/evolution/a9/forecasts-store.js";
import { ProposalEventsAdapter } from "../../src/evolution/a9/adapters/proposal-events-adapter.js";
import { MeasurementEventsAdapter } from "../../src/evolution/a9/adapters/measurement-events-adapter.js";
import { EnrichedProposalsAdapter } from "../../src/evolution/a9/adapters/enriched-proposals-adapter.js";
import { ForecastsAdapter } from "../../src/evolution/a9/forecasts-adapter.js";
import { CorrelationsAdapter } from "../../src/evolution/a9/correlations-adapter.js";
import { ForecastEngine } from "../../src/evolution/a9/forecast-engine.js";
import { CorrelationEngine } from "../../src/evolution/a9/correlation-engine.js";

const NOW = "2026-08-14T00:00:00.000Z";

let catalogDir: string;
let sessionDir: string;
let a9StoreDir: string;

beforeEach(() => {
  catalogDir = mkdtempSync(join(tmpdir(), "a9-cr-cat-"));
  sessionDir = mkdtempSync(join(tmpdir(), "a9-cr-sess-"));
  a9StoreDir = mkdtempSync(join(tmpdir(), "a9-cr-store-"));
});

afterEach(() => {
  rmSync(catalogDir, { recursive: true, force: true });
  rmSync(sessionDir, { recursive: true, force: true });
  rmSync(a9StoreDir, { recursive: true, force: true });
});

describe("A9 composition-root wiring (CapabilityPlatform.a9)", () => {
  it("exposes the constructed A9 adapters + engines bound to the platform EventLog", () => {
    const eventLog = new EventLog(sessionDir);
    const platform = new CapabilityPlatform({
      catalogDir,
      eventLog,
      a9StoreDir,
    });
    expect(platform.a9.proposalEvents).toBeInstanceOf(ProposalEventsAdapter);
    expect(platform.a9.measurementEvents).toBeInstanceOf(MeasurementEventsAdapter);
    expect(platform.a9.enrichedProposals).toBeInstanceOf(EnrichedProposalsAdapter);
    expect(platform.a9.forecasts).toBeInstanceOf(ForecastsAdapter);
    expect(platform.a9.correlations).toBeInstanceOf(CorrelationsAdapter);
    expect(platform.a9.forecastEngine).toBeInstanceOf(ForecastEngine);
    expect(platform.a9.correlationEngine).toBeInstanceOf(CorrelationEngine);
  });

  it("generates a forecast from the platform EventLog and the adapter query surface reads it back", async () => {
    const eventLog = new EventLog(sessionDir);
    const platform = new CapabilityPlatform({ catalogDir, eventLog, a9StoreDir });

    // Write a high-risk proposal.submitted event to the SAME EventLog the
    // platform received (the canonical producer path).
    await eventLog.append({
      type: "capability.governance.proposal.submitted",
      actor: "operator",
      sessionId: "s1",
      payload: {
        proposalId: "prop-1",
        candidate: {
          candidateId: "c-prop-1",
          target: { kind: "capability", id: "cap-1" },
          riskClass: "high",
          evidenceIds: ["ev-1"],
        },
        signalIds: [],
        sourceVersion: null,
      },
    });

    const forecasts = await platform.a9.forecastEngine.forecast(NOW);
    expect(forecasts).toHaveLength(1);
    expect(forecasts[0]!.subject).toBe("prop-1");
    expect(forecasts[0]!.prediction.band).toBe("high");

    // Persist via the A9-owned store at the same storeDir, then verify the
    // composition-root adapter surface reads it back (adapter wired to the
    // store dir).
    const store = new ForecastsStore(a9StoreDir);
    await store.append(forecasts[0]!);
    const viaAdapter = await platform.a9.forecasts.findByProposalId("prop-1");
    expect(viaAdapter).toHaveLength(1);
    expect(viaAdapter[0]!.forecastId).toBe(forecasts[0]!.forecastId);
  });

  it("correlation engine is wired over the platform adapters (automatic correlation, no operator mutation)", async () => {
    const eventLog = new EventLog(sessionDir);
    const platform = new CapabilityPlatform({ catalogDir, eventLog, a9StoreDir });

    await eventLog.append({
      type: "capability.governance.proposal.submitted",
      actor: "operator",
      sessionId: "s1",
      payload: {
        proposalId: "prop-1",
        candidate: { candidateId: "c-prop-1", target: { kind: "capability", id: "cap-1" }, riskClass: "high", evidenceIds: ["ev-1"] },
        signalIds: [],
        sourceVersion: null,
      },
    });
    await eventLog.append({
      type: "capability.governance.proposal.executed",
      actor: "system",
      sessionId: "s1",
      payload: { proposalId: "prop-1" },
    });
    await eventLog.append({
      type: "capability.governance.measurement.measured",
      actor: "system",
      sessionId: "s1",
      payload: {
        measurement: { capabilityId: "cap-1", version: "v1" },
        post: { observationId: "obs-1", takenAt: NOW, status: "complete", confidence: 0.9 },
        outcome: { kind: "effective", evidenceRefs: [], confidence: 0.9, summary: "ok", signals: [] },
      },
    });

    // Persist a forecast so the correlation engine has a candidate.
    const forecasts = await platform.a9.forecastEngine.forecast(NOW);
    const store = new ForecastsStore(a9StoreDir);
    await store.append(forecasts[0]!);

    const correlations = await platform.a9.correlationEngine.correlate(NOW);
    expect(correlations).toHaveLength(1);
    expect(correlations[0]!.forecastId).toBe(forecasts[0]!.forecastId);
    expect(correlations[0]!.measurementId).toBeTruthy();
  });

  it("derives REAL EnrichedProposal[] from .alix stores when none injected (evidence-completeness detector live)", async () => {
    // Scoped cwd: build a real .alix/adaptation/proposals store, then confirm
    // the platform's default enriched source reads it (not the old `?? []`).
    const realCwd = process.cwd();
    const alixRoot = mkdtempSync(join(tmpdir(), "a9-cr-enriched-"));
    const proposalsDir = join(alixRoot, ".alix", "adaptation", "proposals");
    const { ProposalStore } = await import("../../src/adaptation/proposal-store.js");
    const { EffectivenessStore } = await import("../../src/adaptation/effectiveness-store.js");
    const { EvidenceStore } = await import("../../src/security/evidence/evidence-store.js");
    const store = new ProposalStore(proposalsDir);
    await store.save({
      id: "prop-1",
      createdAt: "2026-08-10T00:00:00.000Z",
      status: "applied",
      action: "governance_change",
      target: { kind: "capability", capability: "cap-1" },
      payload: { capabilityId: "cap-1" },
      sourceRecommendationType: "underperformer",
      sourceConfidence: 0.8,
      evidenceFingerprints: ["fp-1"],
      reason: "r",
      approvedAt: "2026-08-11T00:00:00.000Z",
      appliedAt: "2026-08-12T00:00:00.000Z",
    });
    // Required by ProposalLifecycleAnalyzer constructor even though analyze()
    // only reads proposals + effectiveness.
    const effectivenessStore = new EffectivenessStore(join(alixRoot, ".alix", "adaptation", "effectiveness"));
    const evidenceStore = new EvidenceStore({ storeDir: join(alixRoot, ".alix", "security") });

    process.chdir(alixRoot);
    try {
      const eventLog = new EventLog(join(alixRoot, ".alix", "sessions", "s1"));
      const platform = new CapabilityPlatform({ catalogDir, eventLog, a9StoreDir });
      const records = await platform.a9.enrichedProposals.list();
      // The real proposal (via the P10.8a analyzer) is surfaced — the detector
      // is NOT starved of input on the composition-root surface.
      expect(records.length).toBeGreaterThan(0);
      expect(records[0]!.proposalId).toBe("prop-1");
    } finally {
      process.chdir(realCwd);
      rmSync(alixRoot, { recursive: true, force: true });
    }
  });
});
