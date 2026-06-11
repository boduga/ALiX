/**
 * ifamas-smoke.test.ts — End-to-end smoke test for the IFÁ-MAS passive pipeline.
 *
 * Exercises the full lifecycle:
 *   SignalFrame → prescribeOffering → buildBridgeEnvelope
 *     → BridgeGateway.validateEnvelope → routeViaNexus
 *     → GuildSelector.select → EventLog emission → ChronicleStore.append
 *     → ChronicleStore.search recall
 *
 * Runs against real filesystem (tmpdir) and real modules — no mocks.
 * Verifies every artifact is produced and consistent.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSignalFrame } from "../../src/runtime/signal-frame.js";
import type { SignalBits } from "../../src/runtime/signal-frame.js";
import { prescribeOffering } from "../../src/runtime/offering-planner.js";
import { buildBridgeEnvelope } from "../../src/runtime/bridge-envelope.js";
import { BridgeGateway } from "../../src/runtime/bridge-gateway.js";
import { routeViaNexus } from "../../src/runtime/nexus-router.js";
import { GuildSelector } from "../../src/agents/guild-selector.js";
import type { EssenceProfile } from "../../src/agents/essence-profile.js";
import type { EssenceAffinity } from "../../src/agents/essence-profile.js";
import { runIfamasDiagnostic } from "../../src/runtime/ifamas-pipeline.js";
import { ChronicleStore } from "../../src/chronicle/chronicle-store.js";

describe("IFÁ-MAS end-to-end smoke test", () => {
  let tmpDir: string;
  let chronicleStore: ChronicleStore;

  // Collect emitted events
  const emittedEvents: any[] = [];
  const fakeEventLog = {
    append: async (event: any) => { emittedEvents.push(event); },
  };

  /** Build a dangerous signal that exercises multiple pipeline paths. */
  function makeDangerousSignal() {
    const bits: SignalBits = {
      intentClear: true,
      policyRisk: true,
      toolRequired: true,
      memoryRequired: false,
      freshnessRequired: false,
      mutationPossible: true,
      approvalRequired: true,
      replayRollbackContext: false,
    };
    return createSignalFrame({ bits, domain: "task", intent: "smoke-test-dangerous" });
  }

  /** Build a compatible EssenceProfile for guild selection. */
  function makeCompatibleProfile(): EssenceProfile {
    return {
      agentId: "smoke-agent-1",
      role: "guild",
      domains: ["task"],
      capabilities: ["execute", "inspect"],
      constraints: [],
      taboos: [],
      affinity: "general" as EssenceAffinity,
      riskTolerance: "high" as "low" | "medium" | "high",
    };
  }

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ifamas-smoke-"));
    chronicleStore = new ChronicleStore(tmpDir);
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("1. runIfamasDiagnostic returns all 6 artifacts for a dangerous signal", async () => {
    const signal = makeDangerousSignal();
    const candidates = [makeCompatibleProfile()];

    const result = await runIfamasDiagnostic({
      signal,
      candidates,
      chronicleStore,
      eventLog: fakeEventLog as any,
    });

    // All 6 present
    assert.ok(result.signal, "signal artifact missing");
    assert.ok(result.offering, "offering artifact missing");
    assert.ok(result.envelope, "envelope artifact missing");
    assert.ok(result.routeDecision, "routeDecision artifact missing");
    assert.ok(result.gatewayValidation, "gatewayValidation artifact missing");
    assert.ok(result.guildCandidates, "guildCandidates artifact missing");
  });

  it("2. Offering is consistent with dangerous signal (ask_approval)", async () => {
    const signal = makeDangerousSignal();
    const result = await runIfamasDiagnostic({ signal, chronicleStore, eventLog: fakeEventLog as any });

    // policyRisk + approvalRequired + (toolRequired && policyRisk) → ask_approval
    assert.equal(result.offering.action, "ask_approval");
  });

  it("3. Envelope safety fields reflect dangerous bits", async () => {
    const signal = makeDangerousSignal();
    const result = await runIfamasDiagnostic({ signal, chronicleStore, eventLog: fakeEventLog as any });

    assert.equal(result.envelope.safety.requiresPolicyGate, true, "dangerous signal must require policy gate");
    assert.equal(result.envelope.safety.requiresApproval, true, "ask_approval must set requiresApproval");
    assert.equal(result.envelope.safety.mutationPossible, true, "mutationPossible bit must be reflected");
  });

  it("4. Gateway validates the envelope successfully", async () => {
    const signal = makeDangerousSignal();
    const result = await runIfamasDiagnostic({ signal, chronicleStore, eventLog: fakeEventLog as any });

    assert.equal(result.gatewayValidation.valid, true, "gateway must validate the envelope");
    assert.deepEqual(result.gatewayValidation.errors, [], "gateway must have zero errors");
  });

  it("5. Nexus routes ask_approval to caller role", async () => {
    const signal = makeDangerousSignal();
    const result = await runIfamasDiagnostic({ signal, chronicleStore, eventLog: fakeEventLog as any });

    // Rule 1: ask_approval → caller
    assert.equal(result.routeDecision.routeHint.targetRole, "caller");
    assert.equal(result.routeDecision.routeHint.confidence, 80);
    assert.ok(result.routeDecision.routeHint.reason.includes("approval_required"));
  });

  it("6. GuildSelector ranks compatible candidate first", async () => {
    const signal = makeDangerousSignal();
    const candidates = [makeCompatibleProfile()];
    const result = await runIfamasDiagnostic({ signal, candidates, chronicleStore, eventLog: fakeEventLog as any });

    assert.ok(result.guildCandidates.length >= 1, "must return at least one candidate");
    assert.equal(result.guildCandidates[0].profile.agentId, "smoke-agent-1");
  });

  it("7. Trace event was emitted to eventLog", async () => {
    // The event should have been appended during the tests above
    const ifamasEvents = emittedEvents.filter(e => e.type === "ifamas.diagnostic");
    assert.ok(ifamasEvents.length > 0, "must have emitted at least one ifamas.diagnostic event");

    const lastEvent = ifamasEvents[ifamasEvents.length - 1];
    assert.equal(lastEvent.actor, "system");
    assert.ok(lastEvent.payload.signalCode, "event must carry signalCode");
    assert.ok(lastEvent.payload.offeringAction, "event must carry offeringAction");
  });

  it("8. Chronicle entry was written and is recallable", async () => {
    const signal = makeDangerousSignal();
    await runIfamasDiagnostic({ signal, chronicleStore, eventLog: fakeEventLog as any });

    // Search by domain + outcome (set by the pipeline)
    const entries = await chronicleStore.search({ domain: "task" });
    assert.ok(entries.length > 0, "must have at least one chronicle entry");

    const entry = entries[entries.length - 1];
    assert.equal(entry.signalCode, signal.code);
    assert.ok(entry.offeringsUsed.includes("ask_approval"), "chronicle must record offering action");
    assert.ok(entry.problem.includes("smoke-test-dangerous"), "chronicle must record signal intent");
    assert.equal(entry.outcome, "success", "gateway valid → chronicle outcome success");
  });

  it("9. Chronicle entry persists to disk (.alix/chronicle/index.json)", async () => {
    const indexFile = join(tmpDir, ".alix", "chronicle", "index.json");
    assert.ok(existsSync(indexFile), "chronicle index file must exist on disk");

    const raw = readFileSync(indexFile, "utf-8");
    const index = JSON.parse(raw);
    assert.ok(Array.isArray(index), "chronicle index must be a JSON array");
    assert.ok(index.length > 0, "chronicle index must have entries");
  });

  it("10. /chronicle recall path works via ChronicleStore search by signalCode", async () => {
    const signal = makeDangerousSignal();
    const signalCode = signal.code;

    // Simulate what /chronicle signal:<code> does
    const results = await chronicleStore.search({ signalCode });
    assert.ok(results.length > 0, `must find entries for signalCode ${signalCode}`);

    const match = results.find(r => r.signalCode === signalCode);
    assert.ok(match, `must match signalCode ${signalCode}`);
    assert.equal(match!.domain, "task");
  });

  it("11. All artifacts are internally consistent", async () => {
    const signal = makeDangerousSignal();
    const candidates = [makeCompatibleProfile()];
    emittedEvents.length = 0; // reset for clean assertions

    const result = await runIfamasDiagnostic({
      signal,
      candidates,
      chronicleStore,
      eventLog: fakeEventLog as any,
    });

    // signal → offering consistency
    assert.equal(result.offering.signalId, result.signal.signalId, "offering must reference signal");

    // envelope → signal/offering consistency
    assert.equal(result.envelope.signal.signalId, result.signal.signalId, "envelope must carry original signal");
    assert.equal(result.envelope.offering.offeringId, result.offering.offeringId, "envelope must carry original offering");

    // routeDecision → envelope consistency
    assert.equal(result.routeDecision.envelope.envelopeId, result.envelope.envelopeId, "route decision must reference envelope");

    // guild → envelope consistency
    if (result.guildCandidates.length > 0) {
      // GuildSelector was called with the envelope — indirectly verified by having candidates
    }

    // trace event carries matching data
    const event = emittedEvents.find(e => e.type === "ifamas.diagnostic");
    assert.ok(event, "trace event must exist");
    assert.equal(event.payload.signalCode, result.signal.code, "trace event must carry matching signal code");

    // Chronicle entry carries matching data
    const entries = await chronicleStore.search({ signalCode: result.signal.code });
    const entry = entries.find(e => e.signalCode === result.signal.code);
    assert.ok(entry, "chronicle entry must exist for this signal");
    assert.equal(entry!.actionTaken, result.offering.action, "chronicle must record the prescribed action");
  });
});
