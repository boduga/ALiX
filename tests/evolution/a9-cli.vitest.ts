/**
 * A9 Slice 5 — CLI tests (Phase 29).
 *
 * Exercises `runForecastCli` (the handler behind `alix governance evolution
 * forecast [--dimension ...] [--json]`) directly: successful forecast,
 * no-findings, `--json`, dimension filtering, high-risk output
 * (RISK_GATED_REVIEW visible), persistence failure, and adapter failure.
 *
 * The CLI must NOT introduce a second binary — `forecast` is a subcommand of
 * the existing `alix` binary, and `runForecastCli` is a pure handler. No
 * correlation command is exposed (correlation is automatic).
 *
 * @module a9-cli
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runForecastCli } from "../../src/evolution/forecast/forecast-cli.js";
import type { EventLog } from "../../src/events/event-log.js";
import type { AlixEvent } from "../../src/events/types.js";

const NOW = "2026-08-14T00:00:00.000Z";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function fakeEventLog(events: ReadonlyArray<AlixEvent>): EventLog {
  return { readAll: vi.fn(async () => events) } as unknown as EventLog;
}

/** EventLog whose readAll() throws — simulates a failed adapter source. */
function throwingEventLog(message = "events source unavailable"): EventLog {
  return {
    readAll: vi.fn(async () => {
      throw new Error(message);
    }),
  } as unknown as EventLog;
}

function makeEvent(
  type: string,
  payload: Record<string, unknown>,
  timestamp = "2026-08-10T00:00:00.000Z",
): AlixEvent {
  return {
    id: `evt-${type.split(".").pop()}-${Math.random().toString(36).slice(2, 8)}`,
    seq: 1,
    version: 1,
    sessionId: "s1",
    timestamp,
    type,
    actor: "system",
    payload,
  } as AlixEvent;
}

/** Minimal EnrichedProposal fixture (adapter reads proposal + wrapper fields). */
function enrichedProposal(
  overrides: Partial<import("../../src/adaptation/intelligence-types.js").EnrichedProposal["proposal"]> = {},
  wrapper: Partial<
    Record<
      "effectivenessReport" | "revertProposalId" | "timeToApprovalHours" | "timeToApplyHours",
      unknown
    >
  > = {},
): import("../../src/adaptation/intelligence-types.js").EnrichedProposal {
  return {
    proposal: {
      id: "prop-1",
      action: "governance_change",
      target: { kind: "capability", capability: "cap-1" },
      status: "pending",
      createdAt: "2026-08-10T00:00:00.000Z",
      payload: { capabilityId: "cap-1" },
      sourceRecommendationType: "gap",
      sourceConfidence: 0.8,
      evidenceFingerprints: ["fp-1"],
      reason: "r",
      ...overrides,
    },
    effectivenessReport: (wrapper.effectivenessReport as never) ?? null,
    wasReverted: false,
    revertProposalId: (wrapper.revertProposalId as string | null) ?? null,
    outcome: "pending",
    timeToApprovalHours: (wrapper.timeToApprovalHours as number | null) ?? null,
    timeToApplyHours: (wrapper.timeToApplyHours as number | null) ?? null,
  };
}

function submittedEvent(
  proposalId: string,
  targetId: string,
  candidate: Record<string, unknown> = {},
): AlixEvent {
  return makeEvent("capability.governance.proposal.submitted", {
    proposalId,
    candidate: {
      candidateId: `c-${proposalId}`,
      target: { kind: "capability", id: targetId },
      riskClass: candidate.riskClass ?? "high",
      evidenceIds: ["ev-1"],
      ...candidate,
    },
    signalIds: [],
    sourceVersion: null,
  });
}

function executedEvent(proposalId: string): AlixEvent {
  return makeEvent("capability.governance.proposal.executed", { proposalId });
}

/** A high-risk event set → the engine emits exactly one high-band forecast. */
function highRiskEvents(): AlixEvent[] {
  return [submittedEvent("prop-1", "cap-1"), executedEvent("prop-1")];
}

// ---------------------------------------------------------------------------
// Successful forecast
// ---------------------------------------------------------------------------

describe("runForecastCli — successful forecast", () => {
  it("generates, persists, and prints a forecast; exit 0", async () => {
    const dir = await mkdtemp(join(tmpdir(), "a9-cli-ok-"));
    const result = await runForecastCli(
      {
        eventLog: fakeEventLog(highRiskEvents()),
        enrichedProposals: [],
        storeDir: dir,
        json: false,
      },
      NOW,
    );
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("A9 generated 1 pre-execution risk forecast(s).");
    expect(result.output).toContain("prop-1");
    expect(result.output).toContain("HIGH");

    // Persisted to the A9-owned store.
    const { ForecastsStore } = await import("../../src/evolution/forecast/forecasts-store.js");
    const stored = await new ForecastsStore(dir).list();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.subject).toBe("prop-1");
  });

  it("generates a forecast for every finding subject (multi-subject)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "a9-cli-multi-"));
    const result = await runForecastCli(
      {
        eventLog: fakeEventLog([
          submittedEvent("prop-1", "cap-1"),
          submittedEvent("prop-2", "cap-2"),
        ]),
        enrichedProposals: [],
        storeDir: dir,
        json: false,
      },
      NOW,
    );
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("A9 generated 2 pre-execution risk forecast(s).");
    expect(result.output).toContain("prop-1");
    expect(result.output).toContain("prop-2");
  });
});

// ---------------------------------------------------------------------------
// No findings
// ---------------------------------------------------------------------------

describe("runForecastCli — deterministic no-findings output", () => {
  it("prints a deterministic no-findings message; exit 0; nothing persisted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "a9-cli-none-"));
    const result = await runForecastCli(
      { eventLog: fakeEventLog([]), enrichedProposals: [], storeDir: dir, json: false },
      NOW,
    );
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe("No pre-execution risk forecasts detected.");
    const { ForecastsStore } = await import("../../src/evolution/forecast/forecasts-store.js");
    expect(await new ForecastsStore(dir).list()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// --json
// ---------------------------------------------------------------------------

describe("runForecastCli — --json structured output", () => {
  it("emits { forecasts, recommendations }; no-findings emits { noFindings: true }", async () => {
    const dir = await mkdtemp(join(tmpdir(), "a9-cli-json-"));
    const result = await runForecastCli(
      { eventLog: fakeEventLog(highRiskEvents()), enrichedProposals: [], storeDir: dir, json: true },
      NOW,
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.output) as {
      forecasts: ReadonlyArray<{ subject: string; prediction: { band: string } }>;
      recommendations: ReadonlyArray<{ kind: string }>;
    };
    expect(parsed.forecasts).toHaveLength(1);
    expect(parsed.forecasts[0]!.subject).toBe("prop-1");
    expect(parsed.forecasts[0]!.prediction.band).toBe("high");
    expect(parsed.recommendations).toHaveLength(1);
    expect(parsed.recommendations[0]!.kind).toBe("RISK_GATED_REVIEW");

    const none = await runForecastCli(
      { eventLog: fakeEventLog([]), enrichedProposals: [], storeDir: dir, json: true },
      NOW,
    );
    expect(none.exitCode).toBe(0);
    expect(JSON.parse(none.output)).toEqual({ noFindings: true });
  });
});

// ---------------------------------------------------------------------------
// --dimension (supported option, spec §33)
// ---------------------------------------------------------------------------

describe("runForecastCli — --dimension filter (spec §33 supported option)", () => {
  it("filters forecasts to the requested detector kind", async () => {
    const dir = await mkdtemp(join(tmpdir(), "a9-cli-dim-"));
    // highRiskEvents → trust-velocity forecast.
    const matching = await runForecastCli(
      {
        eventLog: fakeEventLog(highRiskEvents()),
        enrichedProposals: [],
        storeDir: dir,
        json: false,
        dimension: "trust-velocity",
      },
      NOW,
    );
    expect(matching.exitCode).toBe(0);
    expect(matching.output).toContain("A9 generated 1 pre-execution risk forecast(s).");
    expect(matching.output).toContain("kind=trust-velocity");
    expect(matching.output).not.toContain("kind=evidence-completeness");
  });

  it("a dimension with no forecasts is a deterministic no-findings result", async () => {
    const dir = await mkdtemp(join(tmpdir(), "a9-cli-dim-none-"));
    const none = await runForecastCli(
      {
        eventLog: fakeEventLog(highRiskEvents()),
        enrichedProposals: [],
        storeDir: dir,
        json: false,
        dimension: "evidence-completeness",
      },
      NOW,
    );
    expect(none.exitCode).toBe(0);
    expect(none.output).toContain("No pre-execution risk forecasts detected.");
  });
});

// ---------------------------------------------------------------------------
// High-risk output — RISK_GATED_REVIEW must be visible
// ---------------------------------------------------------------------------

describe("runForecastCli — high/critical output surfaces RISK_GATED_REVIEW", () => {
  it("prints RISK_GATED_REVIEW for a high-band forecast", async () => {
    const dir = await mkdtemp(join(tmpdir(), "a9-cli-high-"));
    const result = await runForecastCli(
      { eventLog: fakeEventLog(highRiskEvents()), enrichedProposals: [], storeDir: dir, json: false },
      NOW,
    );
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("RISK_GATED_REVIEW");
  });
});

// ---------------------------------------------------------------------------
// A3 decision surface (spec §33: high/critical also surfaces the resulting A3
// decision — REQUEST_MORE_EVIDENCE → UNDER_REVIEW)
// ---------------------------------------------------------------------------

describe("runForecastCli — A3 decision surface", () => {
  it("prints the resulting A3 decision for a high-band forecast (text)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "a9-cli-a3-text-"));
    const result = await runForecastCli(
      { eventLog: fakeEventLog(highRiskEvents()), enrichedProposals: [], storeDir: dir, json: false },
      NOW,
    );
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("A3 decision: REQUEST_MORE_EVIDENCE → UNDER_REVIEW");
  });

  it("emits decisions[] in --json output (RISK_GATED_REVIEW → REQUEST_MORE_EVIDENCE → UNDER_REVIEW)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "a9-cli-a3-json-"));
    const result = await runForecastCli(
      { eventLog: fakeEventLog(highRiskEvents()), enrichedProposals: [], storeDir: dir, json: true },
      NOW,
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.output) as {
      recommendations?: ReadonlyArray<{ kind: string }>;
      decisions?: ReadonlyArray<{
        recommendationKind: string;
        decisionKind: string;
        targetState: string;
      }>;
    };
    expect(parsed.recommendations?.[0]?.kind).toBe("RISK_GATED_REVIEW");
    expect(parsed.decisions?.[0]).toEqual({
      recommendationKind: "RISK_GATED_REVIEW",
      decisionKind: "REQUEST_MORE_EVIDENCE",
      targetState: "UNDER_REVIEW",
    });
  });

  it("medium-band forecasts surface the A3 MONITOR decision (existing A3 path)", async () => {
    // trust-velocity below trigger (riskClass low); enriched incomplete but
    // diverse+fresh → evidence-completeness scores 0.5 → medium → MONITOR.
    const dir = await mkdtemp(join(tmpdir(), "a9-cli-a3-mid-"));
    const result = await runForecastCli(
      {
        eventLog: fakeEventLog([submittedEvent("prop-1", "cap-1", { riskClass: "low" })]),
        enrichedProposals: [enrichedProposal({ evidenceFingerprints: ["fp-1", "fp-2", "fp-3"] })],
        storeDir: dir,
        json: true,
      },
      NOW,
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.output) as {
      decisions?: ReadonlyArray<{
        recommendationKind: string;
        decisionKind: string;
        targetState: string;
      }>;
    };
    expect(parsed.decisions?.[0]?.decisionKind).toBe("MONITOR");
    expect(parsed.decisions?.[0]?.targetState).toBe("UNDER_REVIEW");
  });
});

// ---------------------------------------------------------------------------
// Persistence failure
// ---------------------------------------------------------------------------

describe("runForecastCli — persistence failure fails the operation", () => {
  it("returns exit 1 and never reports the artifact as persisted when the write fails", async () => {
    // storeDir is a FILE, so mkdir/append fails deterministically.
    const dir = await mkdtemp(join(tmpdir(), "a9-cli-perf-"));
    const storeDirAsFile = join(dir, "not-a-dir");
    await writeFile(storeDirAsFile, "occupied", "utf-8");

    const result = await runForecastCli(
      {
        eventLog: fakeEventLog(highRiskEvents()),
        enrichedProposals: [],
        storeDir: storeDirAsFile,
        json: false,
      },
      NOW,
    );
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("Forecast persistence failed");
    // The CLI output must NOT claim a successful forecast (no artifact reported
    // as persisted).
    expect(result.output).not.toContain("A9 generated");

    const jsonResult = await runForecastCli(
      {
        eventLog: fakeEventLog(highRiskEvents()),
        enrichedProposals: [],
        storeDir: storeDirAsFile,
        json: true,
      },
      NOW,
    );
    expect(jsonResult.exitCode).toBe(1);
    const parsed = JSON.parse(jsonResult.output) as { error: string };
    expect(parsed.error).toContain("forecast persistence failed");
  });
});

// ---------------------------------------------------------------------------
// Adapter failure
// ---------------------------------------------------------------------------

describe("runForecastCli — adapter failure (Phase 20)", () => {
  it("a failed source yields no-findings + a surfaced warning; exit 0", async () => {
    const dir = await mkdtemp(join(tmpdir(), "a9-cli-adapter-"));
    const result = await runForecastCli(
      { eventLog: throwingEventLog(), enrichedProposals: [], storeDir: dir, json: false },
      NOW,
    );
    // The run is not destroyed; it continues with available (empty) evidence.
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("No pre-execution risk forecasts detected.");
    // Source unavailability is surfaced explicitly.
    expect(result.output).toContain("Source warning(s)");
    expect(result.output).toContain("proposal-events source unavailable");

    const jsonResult = await runForecastCli(
      { eventLog: throwingEventLog(), enrichedProposals: [], storeDir: dir, json: true },
      NOW,
    );
    const parsed = JSON.parse(jsonResult.output) as { noFindings: boolean; warnings: string[] };
    expect(parsed.noFindings).toBe(true);
    expect(parsed.warnings.some((w) => w.includes("proposal-events source unavailable"))).toBe(true);
  });

  it("a failed source with other evidence still produces a forecast + warning", async () => {
    // proposal-events adapter fails (returns []) but the enriched adapter still
    // fires evidence-completeness → the engine continues with available evidence.
    const dir = await mkdtemp(join(tmpdir(), "a9-cli-adapter2-"));
    const enriched = [
      {
        proposal: {
          id: "prop-1",
          action: "governance_change",
          target: { kind: "capability", capability: "cap-1" },
          status: "pending",
          createdAt: NOW,
        },
        effectivenessReport: null,
        revertProposalId: null,
        timeToApprovalHours: null,
        timeToApplyHours: null,
      } as never,
    ];
    const result = await runForecastCli(
      { eventLog: throwingEventLog(), enrichedProposals: enriched, storeDir: dir, json: false },
      NOW,
    );
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("A9 generated 1 pre-execution risk forecast(s).");
    expect(result.output).toContain("Source warning(s)");
    expect(result.output).toContain("proposal-events source unavailable");
  });
});

// ---------------------------------------------------------------------------
// No second binary / no correlation command
// ---------------------------------------------------------------------------

describe("runForecastCli — single-binary surface, no correlation command", () => {
  it("exposes a handler function, not a second executable binary", async () => {
    expect(typeof runForecastCli).toBe("function");
    const pkg = (await import("../../package.json", { with: { type: "json" } })).default as {
      bin?: Record<string, string>;
    };
    const bins = Object.keys(pkg.bin ?? {});
    expect(bins).toContain("alix");
    // No A9/forecast-specific binary was introduced.
    for (const b of bins) {
      expect(b.toLowerCase()).not.toContain("forecast");
    }
  });

  it("the forecast CLI module exposes no correlation mutation command", async () => {
    const mod = await import("../../src/evolution/forecast/forecast-cli.js");
    const exportNames = Object.keys(mod);
    // No runCorrelationCli / correlate command surface on the CLI.
    expect(exportNames).not.toContain("runCorrelationCli");
    expect(exportNames).not.toContain("runCorrelationCommand");
  });
});
