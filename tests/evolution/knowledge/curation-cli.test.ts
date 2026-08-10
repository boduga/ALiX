// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * Tests for A6 — `alix governance evolution curate` CLI handler.
 *
 * Covers dimension filtering, alias rejection, JSON output shape, the
 * zero-findings invariant (no A3 call), and usage errors.
 *
 * @module curation-cli-test
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleCurationCommand } from "../../../src/evolution/knowledge/curation-cli.js";
import type { GovernanceDecision } from "../../../src/evolution/governance/contracts/decision-contract.js";
import { DEFAULT_GOVERNANCE_POLICY } from "../../../src/evolution/governance/contracts/decision-contract.js";

// ---------------------------------------------------------------------------
// Capture console for testing
// ---------------------------------------------------------------------------

class ConsoleCapture {
  private originalLog: typeof console.log = console.log;
  private originalError: typeof console.error = console.error;
  lines: string[] = [];

  start(): void {
    this.lines = [];
    console.log = (...args: unknown[]) => {
      this.lines.push(args.map(String).join(" "));
    };
    console.error = (...args: unknown[]) => {
      this.lines.push(args.map(String).join(" "));
    };
  }

  restore(): void {
    console.log = this.originalLog;
    console.error = this.originalError;
  }

  output(): string {
    return this.lines.join("\n");
  }
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Create a temp dir that acts as the `.alix` project root for the adapters. */
function makeBaseDir(): string {
  return mkdtempSync(join(tmpdir(), "a6-curate-"));
}

/** Write LearningSignal JSONL records into `<base>/.alix/learning/signals.jsonl`. */
function writeLearningSignals(baseDir: string, signals: unknown[]): void {
  const dir = join(baseDir, ".alix", "learning");
  mkdirSync(dir, { recursive: true });
  const lines = signals.map((s) => JSON.stringify(s)).join("\n") + "\n";
  writeFileSync(join(dir, "signals.jsonl"), lines, "utf-8");
}

function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ok */
  }
}

const RECENT = new Date().toISOString();

/**
 * A fixture producing BOTH a stale finding (old artifact) and a duplicate
 * finding (two recent artifacts sharing a (store, artifactKind, subject)
 * cluster) so dimension filtering is observable.
 */
function writeMixedFixture(baseDir: string): void {
  writeLearningSignals(baseDir, [
    {
      id: "sig-stale",
      generatedAt: "2020-01-01T00:00:00.000Z",
      signalType: "overconfidence",
      summary: "very old learning signal",
    },
    {
      id: "sig-dup-a",
      generatedAt: RECENT,
      signalType: "routing_quality_poor",
      summary: "duplicate content",
    },
    {
      id: "sig-dup-b",
      generatedAt: RECENT,
      signalType: "routing_quality_poor",
      summary: "duplicate content",
    },
  ]);
}

/** A stub A3 decision generator that records calls and returns a canned decision. */
function makeDecisionStub(): {
  fn: (evidence: unknown, recommendation: unknown) => GovernanceDecision;
  calls: Array<[unknown, unknown]>;
} {
  const calls: Array<[unknown, unknown]> = [];
  const fn = (evidence: unknown, recommendation: unknown): GovernanceDecision => {
    calls.push([evidence, recommendation]);
    return {
      decisionId: "govd-stub",
      proposalId: (recommendation as { proposalId?: string }).proposalId ?? "p",
      evolutionId: (recommendation as { proposalId?: string }).proposalId ?? "p",
      kind: "APPROVE",
      confidence: 0.9,
      reasoning: "stub decision",
      risks: [],
      evidenceId: (evidence as { evidenceId?: string }).evidenceId ?? "e",
      recommendationId: (recommendation as { recommendationId?: string }).recommendationId ?? "r",
      recommendationAvailable: true,
      followedRecommendation: true,
      policySnapshot: { ...DEFAULT_GOVERNANCE_POLICY },
      targetState: "APPROVED",
      decidedAt: "2026-08-01T00:00:00.000Z",
      decidedBy: "governance_policy",
      integrityHash: "stub-hash",
    };
  };
  return { fn, calls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("alix governance evolution curate", () => {
  it("filters findings to the stale dimension only with --dimension stale", async () => {
    const baseDir = makeBaseDir();
    writeMixedFixture(baseDir);
    const capture = new ConsoleCapture();
    capture.start();
    try {
      await handleCurationCommand({ baseDir }, ["--dimension", "stale", "--json"]);
      const parsed = JSON.parse(capture.output());
      assert.ok(parsed.findings.length > 0, "expected at least one stale finding");
      for (const f of parsed.findings) {
        assert.equal(f.kind, "stale");
      }
      assert.deepEqual(parsed.proposal.dimension, ["stale"]);
    } finally {
      capture.restore();
      cleanup(baseDir);
    }
  });

  it("accepts the full --dimension duplicate name", async () => {
    const baseDir = makeBaseDir();
    writeMixedFixture(baseDir);
    const capture = new ConsoleCapture();
    capture.start();
    try {
      await handleCurationCommand({ baseDir }, ["--dimension", "duplicate", "--json"]);
      const parsed = JSON.parse(capture.output());
      assert.ok(parsed.findings.length > 0, "expected at least one duplicate finding");
      for (const f of parsed.findings) {
        assert.equal(f.kind, "duplicate");
      }
      assert.deepEqual(parsed.proposal.dimension, ["duplicate"]);
    } finally {
      capture.restore();
      cleanup(baseDir);
    }
  });

  it("rejects the --dimension dup alias with a usage error and exit 1", async () => {
    const baseDir = makeBaseDir();
    const capture = new ConsoleCapture();
    capture.start();
    try {
      await handleCurationCommand({ baseDir }, ["--dimension", "dup"]);
      const out = capture.output();
      assert.ok(out.includes("Usage"), out);
      assert.equal(process.exitCode, 1);
    } finally {
      process.exitCode = 0;
      capture.restore();
      cleanup(baseDir);
    }
  });

  it("rejects the --dimension compress alias with a usage error and exit 1", async () => {
    const baseDir = makeBaseDir();
    const capture = new ConsoleCapture();
    capture.start();
    try {
      await handleCurationCommand({ baseDir }, ["--dimension", "compress"]);
      const out = capture.output();
      assert.ok(out.includes("Usage"), out);
      assert.equal(process.exitCode, 1);
    } finally {
      process.exitCode = 0;
      capture.restore();
      cleanup(baseDir);
    }
  });

  it("rejects an unknown dimension with a usage error and exit 1", async () => {
    const baseDir = makeBaseDir();
    const capture = new ConsoleCapture();
    capture.start();
    try {
      await handleCurationCommand({ baseDir }, ["--dimension", "bogus"]);
      const out = capture.output();
      assert.ok(out.includes("Usage"), out);
      assert.equal(process.exitCode, 1);
    } finally {
      process.exitCode = 0;
      capture.restore();
      cleanup(baseDir);
    }
  });

  it("--json produces valid output {findings, proposal, decision} for non-empty findings", async () => {
    const baseDir = makeBaseDir();
    writeMixedFixture(baseDir);
    const capture = new ConsoleCapture();
    capture.start();
    try {
      await handleCurationCommand({ baseDir }, ["--json"]);
      const parsed = JSON.parse(capture.output());
      assert.ok(Array.isArray(parsed.findings));
      assert.ok(parsed.findings.length > 0);
      assert.ok(parsed.proposal, "proposal must be present when findings exist");
      assert.ok(typeof parsed.proposal.proposalId === "string");
      assert.ok(parsed.decision, "decision must be present when a proposal exists");
      assert.ok(typeof parsed.decision.decisionId === "string");
    } finally {
      capture.restore();
      cleanup(baseDir);
    }
  });

  it("prints 'No curation findings' and does not call A3 when there are no findings", async () => {
    const baseDir = makeBaseDir();
    const { fn, calls } = makeDecisionStub();
    const capture = new ConsoleCapture();
    capture.start();
    try {
      await handleCurationCommand({ baseDir, generateDecision: fn }, []);
      const out = capture.output();
      assert.ok(out.includes("No curation findings"), out);
      assert.equal(calls.length, 0, "generateDecision must not be called on empty findings");
    } finally {
      capture.restore();
      cleanup(baseDir);
    }
  });

  it("calls generateDecision (A3) with evidence + recommendation for non-empty findings", async () => {
    const baseDir = makeBaseDir();
    writeMixedFixture(baseDir);
    const { fn, calls } = makeDecisionStub();
    const capture = new ConsoleCapture();
    capture.start();
    try {
      await handleCurationCommand({ baseDir, generateDecision: fn }, ["--json"]);
      assert.equal(calls.length, 1);
      const [evidence, recommendation] = calls[0];
      assert.ok(evidence && typeof (evidence as { evidenceId?: string }).evidenceId === "string");
      assert.ok(recommendation && (recommendation as { kind?: string }).kind === "APPROVE");
    } finally {
      capture.restore();
      cleanup(baseDir);
    }
  });
});
