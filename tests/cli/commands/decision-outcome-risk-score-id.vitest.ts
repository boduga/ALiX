/**
 * P7.5p.2c — CLI integration test: runOutcomeRecord captures
 * RiskScore id (lookup, override, or undefined).
 *
 * Contract (per plan Task 3):
 * 1. Stored recommendation's riskScoreId used when --recommendation found.
 * 2. --risk-score-id override wins when both present.
 * 3. --recommendation rec-missing AND no override → riskScoreId === undefined.
 *    (Never faked to a placeholder.)
 * 4. No --recommendation AND no --risk-score-id → riskScoreId === undefined.
 * 5. No --recommendation AND --risk-score-id risk-explicit →
 *    riskScoreId === "risk-explicit".
 *
 * riskScoreId lives on OutcomeRecord (NOT OutcomeArtifact) — it is
 * outcome-specific provenance, not a generic artifact concern.
 *
 * Test exercises CLI entry point (handleDecisionCommand) with stub args
 * array, points process.cwd at temp dir so store resolves to the
 * right path.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleDecisionCommand } from "../../../src/cli/commands/decision.js";
import { ApprovalRecommendationStore } from "../../../src/adaptation/approval-recommendation-store.js";
import type { ApprovalRecommendation } from "../../../src/adaptation/recommendation-types.js";
import type { OutcomeRecord } from "../../../src/adaptation/outcome-types.js";

// ---------------------------------------------------------------------------
// process.cwd override + output capture
// ---------------------------------------------------------------------------

let cwdSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "decision-outcome-risk-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });
});

afterEach(() => {
  cwdSpy.mockRestore();
  logSpy.mockRestore();
  errorSpy.mockRestore();
  exitSpy.mockRestore();
  rmSync(tempRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixtures + helpers
// ---------------------------------------------------------------------------

function makeRec(overrides: Partial<ApprovalRecommendation> = {}): ApprovalRecommendation {
  return {
    id: "rec-1",
    subject: "Test",
    outcome: "approve",
    confidence: 0.85,
    reasons: [],
    generatedAt: new Date().toISOString(),
    recommendation: "approve",
    proposalId: "prop-1",
    sourceArtifacts: [],
    ...overrides,
  };
}

async function seedRec(rec: ApprovalRecommendation): Promise<void> {
  const store = new ApprovalRecommendationStore();
  await store.append(rec);
}

function readOutcomes(): OutcomeRecord[] {
  const path = join(tempRoot, ".alix", "adaptation", "outcomes", "outcomes.jsonl");
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf-8");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as OutcomeRecord);
}

describe("decision outcome: riskScoreId from recommendation store (P7.5p.2c)", () => {
  it("uses stored recommendation's riskScoreId when --recommendation found", async () => {
    await seedRec(makeRec({ id: "rec-1", riskScoreId: "risk-prop-1" }));

    await handleDecisionCommand([
      "outcome",
      "record",
      "prop-1",
      "--outcome",
      "success",
      "--recommendation",
      "rec-1",
    ]);

    const outcomes = readOutcomes();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].riskScoreId).toBe("risk-prop-1");
  });

  it("--risk-score-id override wins when both store value and flag present", async () => {
    await seedRec(makeRec({ id: "rec-1", riskScoreId: "risk-prop-1" }));

    await handleDecisionCommand([
      "outcome",
      "record",
      "prop-1",
      "--outcome",
      "success",
      "--recommendation",
      "rec-1",
      "--risk-score-id",
      "risk-override",
    ]);

    const outcomes = readOutcomes();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].riskScoreId).toBe("risk-override");
  });

  it("--recommendation rec-missing AND no override → riskScoreId === undefined (never faked)", async () => {
    // No seed — store empty.
    await handleDecisionCommand([
      "outcome",
      "record",
      "prop-1",
      "--outcome",
      "success",
      "--recommendation",
      "rec-missing",
    ]);

    const outcomes = readOutcomes();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].riskScoreId).toBeUndefined();
  });

  it("no --recommendation AND no --risk-score-id → riskScoreId === undefined", async () => {
    await handleDecisionCommand([
      "outcome",
      "record",
      "prop-1",
      "--outcome",
      "success",
    ]);

    const outcomes = readOutcomes();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].riskScoreId).toBeUndefined();
  });

  it("no --recommendation AND --risk-score-id risk-explicit → riskScoreId === risk-explicit", async () => {
    await handleDecisionCommand([
      "outcome",
      "record",
      "prop-1",
      "--outcome",
      "success",
      "--risk-score-id",
      "risk-explicit",
    ]);

    const outcomes = readOutcomes();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].riskScoreId).toBe("risk-explicit");
  });
});