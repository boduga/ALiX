/**
 * A9 — Architectural sentinels (Slice 1).
 *
 * Two static guards pin corrected facts verified during Phase 0:
 *
 *   1. A9 does NOT consume A8's normalized aggregation layer. A9 is its own
 *      module (`src/evolution/forecast/`); adapters preserve RAW evidence. A9 source
 *      files MUST NOT import `src/evolution/learning/` or its adapters.
 *      (Corrected fact #3; brief adapter test item 6.)
 *
 *   2. Forecast DETECTORS MUST NOT consume measurement events. Measurement
 *      consumption belongs to the later correlation slice, not forecast
 *      generation (Q8 + corrected fact #2). Detector source files MUST NOT
 *      import the measurement adapter.
 *
 * These are hard guards: a single failure fails the test.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { importedSpecifiers, importedBindings, codeOnly } from "../helpers/import-graph.js";
// Runtime re-pins for identity determinism (Phase 28).
import { forecastIdFor, correlationIdFor } from "../../src/evolution/forecast/identity.js";
import type { ForecastContent, CorrelationContent } from "../../src/evolution/forecast/contracts/contract.js";
import { FORECAST_VERSION, GENERATOR_VERSION, CORRELATION_VERSION } from "../../src/evolution/forecast/contracts/contract.js";

const A9_ROOT = join(process.cwd(), "src", "evolution", "forecast");
const A9_DETECTORS_ROOT = join(A9_ROOT, "detectors");
const SRC_ROOT = join(process.cwd(), "src");
const A8_LEARNING_ROOT = join(SRC_ROOT, "evolution", "learning");

/** True when `file` has a relative import whose resolved path lands under `dir`. */
function importsUnder(file: string, dir: string): boolean {
  for (const spec of importedSpecifiers(file)) {
    if (!spec.startsWith(".")) continue;
    if (pathResolve(dirname(file), spec).startsWith(dir)) return true;
  }
  return false;
}

/** Recursively walk a directory returning all *.ts files (skipping *.d.ts). */
function walkTsFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkTsFiles(full));
    else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

describe("A9 sentinel — A9 does not consume A8's normalized layer (raw evidence preserved)", () => {
  it("no A9 source file imports src/evolution/learning (A9 is its own module)", () => {
    const files = walkTsFiles(A9_ROOT);
    expect(files.length, "A9 source tree must contain .ts files").toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      // Resolve the real import graph: any relative specifier whose target
      // lands under src/evolution/learning is A8's normalized layer.
      if (importsUnder(file, A8_LEARNING_ROOT)) {
        offenders.push(`${file}  [A8 normalized aggregation layer (src/evolution/learning)]`);
      }
    }
    expect(
      offenders,
      `A9 source must not consume A8 normalized records; offenders:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

describe("A9 sentinel — forecast detectors do NOT consume measurement events (Slice 4 concern)", () => {
  it("no detector source file imports the measurement adapter", () => {
    const files = walkTsFiles(A9_DETECTORS_ROOT);
    expect(files.length, "A9 detectors tree must contain .ts files").toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const specs = importedSpecifiers(file);
      const binds = importedBindings(file);
      if (
        [...specs].some((s) => s.includes("measurement-events-adapter")) ||
        binds.has("CapabilityMeasurementRecord")
      ) {
        offenders.push(file);
      }
    }
    expect(
      offenders,
      `A9 forecast detectors must not consume measurement events (correlation slice concern); offenders:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Phase 28 — comprehensive architectural sentinels (Slice 5).
// Pins every boundary likely to regress: identity, persistence ownership,
// foreign references, measurement namespace, CAP-9 taxonomy, A2.5/A3
// taxonomy, the A8 boundary, and the correlation bridge anchors.
// ---------------------------------------------------------------------------

describe("A9 sentinel — identity is a deterministic canonical hash (Phase 28)", () => {
  it("forecastId and correlationId are 64-hex content addresses, deterministic", () => {
    const forecastContent: ForecastContent = {
      forecastVersion: FORECAST_VERSION,
      subject: "prop-1",
      subjectCapability: "cap-1",
      prediction: { kind: "trust-velocity", band: "high", internalScore: 0.7 },
      horizon: { from: "2026-08-01T00:00:00.000Z", to: "2026-08-31T00:00:00.000Z" },
      confidence: 0.8,
      provenance: {
        generatedAt: "2026-08-01T00:00:00.000Z",
        generatorVersion: GENERATOR_VERSION,
        evidenceRefs: ["ev-1"],
      },
    };
    const correlationContent: CorrelationContent = {
      correlationVersion: CORRELATION_VERSION,
      forecastId: "f1",
      measurementId: "m1",
      foreignProvenance: { proposalId: "p1" },
      resolution: { band: "low", forecastBand: "high", delta: "over-forecast" },
    };
    for (const id of [forecastIdFor(forecastContent), correlationIdFor(correlationContent)]) {
      expect(id).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(forecastIdFor(forecastContent)).toBe(forecastIdFor(forecastContent));
    expect(correlationIdFor(correlationContent)).toBe(correlationIdFor(correlationContent));
  });

  it("identity.ts derives ids via SHA-256 of canonical content (not JSONL position)", () => {
    const identitySrc = codeOnly(readFileSync(join(A9_ROOT, "identity.ts"), "utf-8"));
    expect(identitySrc).toContain("sha256");
    expect(identitySrc).toContain("canonicalStringify");
  });
});

describe("A9 sentinel — persistence stays A9-owned (forecasts.jsonl / correlations.jsonl)", () => {
  it("only src/evolution/forecast defines the two A9-owned store files", () => {
    const offenders: string[] = [];
    for (const file of walkTsFiles(SRC_ROOT)) {
      const src = codeOnly(readFileSync(file, "utf-8"));
      if (src.includes('"forecasts.jsonl"') || src.includes('"correlations.jsonl"')) {
        if (!file.startsWith(A9_ROOT)) offenders.push(file);
      }
    }
    expect(
      offenders,
      `forecasts.jsonl / correlations.jsonl must be A9-owned; offenders:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

describe("A9 sentinel — foreign IDs are references; measurement namespace carries no proposal linkage", () => {
  it("CapabilityMeasurementPayload (measurement-event-types.ts) does NOT gain proposalId / sourceProposalIds / forecastId / correlationId", () => {
    const payloadSrc = codeOnly(
      readFileSync(join(SRC_ROOT, "capability", "measurement", "measurement-event-types.ts"), "utf-8"),
    );
    for (const forbidden of ["proposalId", "sourceProposalIds", "forecastId", "correlationId"]) {
      expect(
        payloadSrc.includes(forbidden),
        `CapabilityMeasurementPayload must not gain '${forbidden}'`,
      ).toBe(false);
    }
  });

  it("A9's CapabilityMeasurementRecord contract exposes no proposal linkage (foreign ids are references only)", () => {
    const contractSrc = codeOnly(readFileSync(join(A9_ROOT, "contracts", "contract.ts"), "utf-8"));
    for (const forbidden of ["proposalId", "sourceProposalIds", "forecastId", "correlationId"]) {
      // The A9 measurement record region must not declare these fields.
      const recordRegion = contractSrc.slice(
        contractSrc.indexOf("export interface CapabilityMeasurementRecord"),
        contractSrc.indexOf("export interface EnrichedProposalRecord"),
      );
      expect(
        recordRegion.includes(`readonly ${forbidden}`) || recordRegion.includes(`${forbidden}:`),
        `CapabilityMeasurementRecord must not expose '${forbidden}'`,
      ).toBe(false);
    }
  });
});

describe("A9 sentinel — CAP-9 five-event proposal taxonomy unchanged", () => {
  it("the governance proposal event set is exactly the five CAP-9 kinds", async () => {
    const {
      CAPABILITY_GOVERNANCE_EVENT_TYPES,
      GOVERNANCE_EVENT_PREFIX,
      isGovernanceEventType,
    } = await import("../../src/capability/governance/governance-types.js");
    const proposalKinds = CAPABILITY_GOVERNANCE_EVENT_TYPES.filter((k) => k.startsWith(GOVERNANCE_EVENT_PREFIX));
    expect([...proposalKinds].sort()).toEqual(
      [
        "capability.governance.proposal.approved",
        "capability.governance.proposal.executed",
        "capability.governance.proposal.execution_failed",
        "capability.governance.proposal.rejected",
        "capability.governance.proposal.submitted",
      ].sort(),
    );
    // No sixth proposal.* kind: the validator agrees with the vocabulary.
    expect(isGovernanceEventType("capability.governance.proposal.submitted")).toBe(true);
    expect(isGovernanceEventType("capability.governance.proposal.archived")).toBe(false);
  });
});

describe("A9 sentinel — A2.5 / A3 taxonomy frozen", () => {
  it("A2.5 has exactly six recommendation kinds incl. RISK_GATED_REVIEW", async () => {
    const {
      GOVERNANCE_RECOMMENDATION_KINDS,
      isValidGovernanceRecommendationKind,
    } = await import("../../src/evolution/verification/contracts/recommendation-contract.js");
    expect([...GOVERNANCE_RECOMMENDATION_KINDS].sort()).toEqual(
      ["APPROVE", "ESCALATE", "MONITOR", "REJECT", "REQUEST_ADDITIONAL_EVIDENCE", "RISK_GATED_REVIEW"].sort(),
    );
    expect(isValidGovernanceRecommendationKind("RISK_GATED_REVIEW")).toBe(true);
    expect(isValidGovernanceRecommendationKind("MAYBE")).toBe(false);
  });

  it("A3 retains exactly four binding decision kinds and three target states", async () => {
    const {
      VALID_GOVERNANCE_DECISION_KINDS,
      isValidGovernanceDecisionKind,
      validateGovernanceDecision,
    } = await import("../../src/evolution/governance/contracts/decision-contract.js");
    expect([...VALID_GOVERNANCE_DECISION_KINDS].sort()).toEqual(
      ["APPROVE", "MONITOR", "REJECT", "REQUEST_MORE_EVIDENCE"].sort(),
    );
    expect(isValidGovernanceDecisionKind("APPROVE")).toBe(true);
    expect(isValidGovernanceDecisionKind("MAYBE")).toBe(false);
    // Target states surface through the validator: bogus is rejected with
    // the exact closed set; each valid state produces no targetState error.
    const base = {
      decisionId: "govd-1",
      proposalId: "p",
      evolutionId: "e",
      kind: "APPROVE",
      confidence: 0.5,
      reasoning: "r",
      risks: [],
      evidenceId: "ev",
      recommendationAvailable: false,
      followedRecommendation: false,
      policySnapshot: {},
    };
    const bogus = validateGovernanceDecision({ ...base, targetState: "BOGUS" });
    expect(bogus.errors.some((e) => e.includes("APPROVED") && e.includes("REJECTED") && e.includes("UNDER_REVIEW"))).toBe(true);
    for (const state of ["APPROVED", "REJECTED", "UNDER_REVIEW"]) {
      const result = validateGovernanceDecision({ ...base, targetState: state });
      expect(result.errors.some((e) => e.includes("targetState"))).toBe(false);
    }
  });

  it("A9 does NOT import A8's enriched-proposal-aggregator / normalization layer", () => {
    for (const file of walkTsFiles(A9_ROOT)) {
      const specs = [...importedSpecifiers(file)];
      expect(
        specs.some((s) => s.includes("enriched-proposal-aggregator")),
        `${file} must not import A8's enriched-proposal-aggregator`,
      ).toBe(false);
    }
  });
});

describe("A9 sentinel — correlation bridge uses the canonical two-hop anchors", () => {
  it("reads proposal.submitted.payload.candidate.target.id via the shared accessor and requires proposal.executed", () => {
    // The bridge anchor is read by ONE shared typed accessor (Std #4), used by
    // both the proposal adapter and the correlation engine. Pin it here so the
    // `candidate.target.id` read never drifts back into per-site hand-rolling.
    const bridgeSrc = codeOnly(readFileSync(join(A9_ROOT, "bridge-target.ts"), "utf-8"));
    expect(bridgeSrc).toContain("candidate");
    expect(bridgeSrc).toContain("target");
    expect(bridgeSrc).toContain("ProposalSubmittedPayload");
    const engineSrc = codeOnly(readFileSync(join(A9_ROOT, "correlation-engine.ts"), "utf-8"));
    // The engine delegates to the shared accessor (does not hand-roll the read).
    expect(engineSrc).toContain("readCandidateTargetId");
    // Execution requirement: proposal.executed gates correlation.
    expect(engineSrc).toContain('case "proposal.executed"');
    expect(engineSrc).toContain('case "proposal.rejected"');
    // It NEVER reads a proposal id from the measurement side (Q8). Proposal
    // events legitimately carry proposalId (event.proposalId); the measurement
    // record does NOT.
    expect(engineSrc).not.toContain("measurement.proposalId");
    expect(engineSrc).not.toContain("measurement?.");
    expect(engineSrc).not.toMatch(/measurement\s*\]?\s*\[\s*['"]proposalId['"]/);
  });
});
