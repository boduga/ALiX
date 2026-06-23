/**
 * P7.5p.1c — CLI integration test: runOutcomeRecord captures
 * ApprovalRecommendation confidence (lookup, override, or undefined).
 *
 * Contract (per plan Task 3):
 * 1. Stored recommendation's confidence is used when --recommendation is found.
 * 2. --recommendation-confidence override wins when both are present.
 * 3. Override works when recommendation is missing from store.
 * 4. Missing recommendation + no override → confidence === undefined (NEVER fake 1).
 * 5. No --recommendation and no override → confidence === undefined.
 *
 * Test exercises CLI entry point (handleDecisionCommand) with a stub args
 * array, points process.cwd at a temp dir so the store resolves the right
 * path.
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
  tempRoot = mkdtempSync(join(tmpdir(), "decision-outcome-"));
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

describe("decision outcome: confidence from recommendation store (P7.5p.1c)", () => {
  it("uses stored recommendation's confidence when --recommendation is found", async () => {
    await seedRec(makeRec({ id: "rec-1", confidence: 0.85 }));

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
    expect(outcomes[0].confidence).toBe(0.85);
  });

  it("--recommendation-confidence override wins when both store value and flag present", async () => {
    await seedRec(makeRec({ id: "rec-1", confidence: 0.85 }));

    await handleDecisionCommand([
      "outcome",
      "record",
      "prop-1",
      "--outcome",
      "success",
      "--recommendation",
      "rec-1",
      "--recommendation-confidence",
      "0.42",
    ]);

    const outcomes = readOutcomes();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].confidence).toBe(0.42);
  });

  it("override works when recommendation is missing from store", async () => {
    // No seed — store is empty.

    await handleDecisionCommand([
      "outcome",
      "record",
      "prop-1",
      "--outcome",
      "success",
      "--recommendation",
      "rec-missing",
      "--recommendation-confidence",
      "0.73",
    ]);

    const outcomes = readOutcomes();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].confidence).toBe(0.73);
  });

  it("missing recommendation + no override → confidence is undefined (NEVER faked to 1)", async () => {
    // No seed — store is empty.

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
    expect(outcomes[0].confidence).toBeUndefined();
  });

  it("no --recommendation and no override → confidence is undefined", async () => {
    await handleDecisionCommand([
      "outcome",
      "record",
      "prop-1",
      "--outcome",
      "success",
    ]);

    const outcomes = readOutcomes();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].confidence).toBeUndefined();
  });
});
