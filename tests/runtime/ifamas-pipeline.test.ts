import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runIfamasDiagnostic, type IfamasDiagnostic } from "../../src/runtime/ifamas-pipeline.js";
import { createSignalFrame } from "../../src/runtime/signal-frame.js";
import type { SignalBits, SignalFrame } from "../../src/runtime/signal-frame.js";
import type { EssenceProfile } from "../../src/agents/essence-profile.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeSafeSignal(): SignalFrame {
  const bits: SignalBits = {
    intentClear: true,
    policyRisk: false,
    toolRequired: false,
    memoryRequired: false,
    freshnessRequired: false,
    mutationPossible: false,
    approvalRequired: false,
    replayRollbackContext: false,
  };
  return createSignalFrame({ bits, domain: "task", intent: "diagnostic test" });
}

function makeCompatibleProfile(): EssenceProfile {
  return {
    agentId: "guild-agent-1",
    role: "guild",
    domains: ["task"],
    capabilities: ["execute", "inspect"],
    constraints: [],
    taboos: [],
    affinity: "general",
    riskTolerance: "medium",
  };
}

/* ------------------------------------------------------------------ */
/*  ifamas-pipeline                                                    */
/* ------------------------------------------------------------------ */

describe("IFÁ-MAS Passive Diagnostic Pipeline", () => {
  /* ---------------------------------------------------------------- */
  /*  1. Returns all diagnostic artifacts                              */
  /* ---------------------------------------------------------------- */

  it("returns all 6 diagnostic fields", async () => {
    const signal = makeSafeSignal();
    const result = await runIfamasDiagnostic({ signal });

    assert.ok(result, "result should be truthy");
    assert.ok(result.signal, "signal field present");
    assert.ok(result.offering, "offering field present");
    assert.ok(result.envelope, "envelope field present");
    assert.ok(result.routeDecision, "routeDecision field present");
    assert.ok(result.gatewayValidation, "gatewayValidation field present");
    assert.ok(Array.isArray(result.guildCandidates), "guildCandidates is an array");
  });

  /* ---------------------------------------------------------------- */
  /*  2. Preserves the original signal                                 */
  /* ---------------------------------------------------------------- */

  it("preserves the original signal signalId", async () => {
    const signal = makeSafeSignal();
    const result = await runIfamasDiagnostic({ signal });

    assert.equal(result.signal.signalId, signal.signalId);
  });

  /* ---------------------------------------------------------------- */
  /*  3. Produces OfferingPlan from signal                             */
  /* ---------------------------------------------------------------- */

  it("produces OfferingPlan with action and offeringId", async () => {
    const signal = makeSafeSignal();
    const result = await runIfamasDiagnostic({ signal });

    assert.ok(result.offering.offeringId, "offeringId should be present");
    assert.equal(typeof result.offering.offeringId, "string");
    assert.ok(result.offering.action, "action should be present");
    assert.equal(typeof result.offering.action, "string");
  });

  /* ---------------------------------------------------------------- */
  /*  4. Builds BridgeEnvelope                                         */
  /* ---------------------------------------------------------------- */

  it("builds BridgeEnvelope with envelopeId and safety fields", async () => {
    const signal = makeSafeSignal();
    const result = await runIfamasDiagnostic({ signal });

    assert.ok(result.envelope.envelopeId, "envelopeId should be present");
    assert.equal(typeof result.envelope.envelopeId, "string");
    assert.ok(result.envelope.safety, "safety field should be present");
    assert.equal(typeof result.envelope.safety.requiresPolicyGate, "boolean");
    assert.equal(typeof result.envelope.safety.requiresApproval, "boolean");
    assert.equal(typeof result.envelope.safety.mutationPossible, "boolean");
    assert.ok(Array.isArray(result.envelope.safety.taboos));
  });

  /* ---------------------------------------------------------------- */
  /*  5. Validates through BridgeGateway                               */
  /* ---------------------------------------------------------------- */

  it("validates successfully through BridgeGateway", async () => {
    const signal = makeSafeSignal();
    const result = await runIfamasDiagnostic({ signal });

    assert.equal(result.gatewayValidation.valid, true);
    assert.deepEqual(result.gatewayValidation.errors, []);
  });

  /* ---------------------------------------------------------------- */
  /*  6. Routes through NexusRouter                                    */
  /* ---------------------------------------------------------------- */

  it("routes through NexusRouter with routeHint.targetRole", async () => {
    const signal = makeSafeSignal();
    const result = await runIfamasDiagnostic({ signal });

    assert.ok(result.routeDecision.routeHint, "routeHint should be present");
    assert.ok(result.routeDecision.routeHint.targetRole, "targetRole should be present");
    assert.equal(typeof result.routeDecision.routeHint.targetRole, "string");
  });

  /* ---------------------------------------------------------------- */
  /*  7. Skips guild selection when no candidates                      */
  /* ---------------------------------------------------------------- */

  it("returns empty guildCandidates when no candidates provided", async () => {
    const signal = makeSafeSignal();
    const result = await runIfamasDiagnostic({ signal });

    assert.deepEqual(result.guildCandidates, []);
  });

  /* ---------------------------------------------------------------- */
  /*  8. Returns candidates when compatible candidates provided        */
  /* ---------------------------------------------------------------- */

  it("returns guild candidates when compatible candidates provided", async () => {
    const signal = makeSafeSignal();
    const candidate = makeCompatibleProfile();
    const result = await runIfamasDiagnostic({
      signal,
      candidates: [candidate],
    });

    assert.ok(result.guildCandidates.length > 0,
      "should have at least one guild candidate");
    assert.equal(result.guildCandidates[0].profile.agentId, "guild-agent-1");
    assert.ok(result.guildCandidates[0].compatible, "candidate should be compatible");
  });

  /* ---------------------------------------------------------------- */
  /*  9. Works without ChronicleStore                                  */
  /* ---------------------------------------------------------------- */

  it("works without ChronicleStore (does not throw)", async () => {
    const signal = makeSafeSignal();
    // ChronicleStore is not passed — should still succeed
    const result = await runIfamasDiagnostic({ signal });

    assert.ok(result);
    assert.equal(result.gatewayValidation.valid, true);
  });

  /* ---------------------------------------------------------------- */
  /*  10. Does NOT import ToolExecutor or PolicyGate                   */
  /* ---------------------------------------------------------------- */

  it("does NOT import ToolExecutor or PolicyGate", () => {
    // Grep the source file for forbidden import references
    const __dirname = fileURLToPath(new URL(".", import.meta.url));
    const sourcePath = resolve(
      __dirname,
      "../../../src/runtime/ifamas-pipeline.ts",
    );
    const source = readFileSync(sourcePath, "utf8");

    const lines = source.split("\n");
    const forbidden = ["ToolExecutor", "PolicyGate", "ApprovalStore"];
    for (const line of lines) {
      // Only check import lines to avoid false positives from comments
      const trimmed = line.trim();
      if (!trimmed.startsWith("import ")) continue;

      for (const name of forbidden) {
        if (trimmed.includes(name)) {
          assert.fail(
            `Source file must not import ${name}, but found: ${trimmed}`,
          );
        }
      }
    }
  });

  it("emits trace event when eventLog is provided", async () => {
    const signal = makeSafeSignal();
    const emitted: any[] = [];
    const fakeEventLog = {
      append: async (event: any) => { emitted.push(event); },
    };

    const result = await runIfamasDiagnostic({
      signal,
      eventLog: fakeEventLog as any,
    });

    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].type, "ifamas.diagnostic");
    assert.equal(emitted[0].payload.signalCode, signal.code);
    assert.equal(emitted[0].actor, "system");
  });

  it("does not throw when eventLog.append fails", async () => {
    const signal = makeSafeSignal();
    const brokenEventLog = {
      append: async () => { throw new Error("storage error"); },
    };

    const result = await runIfamasDiagnostic({
      signal,
      eventLog: brokenEventLog as any,
    });

    assert.ok(result);
    assert.equal(result.signal.signalId, signal.signalId);
  });
});
