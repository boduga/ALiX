/**
 * P7.5p.3c — CLI integration test: runOutcomeRecord captures
 * governanceReviewId (auto-lookup, override, or undefined).
 *
 * Contract (per plan Task 3):
 * 1. Single stored review for proposal, no override → auto-lookup links it.
 * 2. --governance-review-id override wins when both store value and flag present.
 * 3. No review in store AND no override → governanceReviewId === undefined
 *    (never faked to placeholder).
 * 4. No review in store AND --governance-review-id review-explicit →
 *    governanceReviewId === "review-explicit".
 * 5. Multiple reviews same proposal, no override → most-recent (last-appended).
 * 6. Outcome for prop-2, reviews only for prop-1 → governanceReviewId === undefined
 *    (auto-lookup is proposal-scoped).
 * 7. Cross-proposal isolation (governance-boundary invariant): prop-A's outcome
 *    links review-a, NOT the newer review-b for prop-B. A regression to
 *    list().at(-1) would return review-b and fail this test.
 *
 * governanceReviewId lives on OutcomeRecord (NOT OutcomeArtifact) — it is
 * outcome-specific provenance, not generic artifact concern.
 *
 * Test exercises the CLI entry point (handleDecisionCommand) with a stub args
 * array, pointing process.cwd at a temp dir so the store resolves the right
 * path.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleDecisionCommand } from "../../../src/cli/commands/decision.js";
import { GovernanceReviewStore } from "../../../src/adaptation/governance-review-store.js";
import type {
  GovernanceReview,
  LensScore,
  CouncilVote,
} from "../../../src/adaptation/governance-review-types.js";
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
  tempRoot = mkdtempSync(join(tmpdir(), "decision-outcome-gov-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
    throw new Error("process.exit called");
  }) as never);
});

afterEach(() => {
  cwdSpy.mockRestore();
  logSpy.mockRestore();
  errorSpy.mockRestore();
  exitSpy.mockRestore();
  rmSync(tempRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// fixture helpers
// ---------------------------------------------------------------------------

const councilVote: CouncilVote = {
  agree: 2,
  agreeWithConcerns: 1,
  challenge: 1,
  insufficientInformation: 0,
};

const lensScores: LensScore[] = [
  { lens: "red_team", recommendedVerdict: "challenge", confidence: 0.8, rationale: "high risk" },
  { lens: "historian", recommendedVerdict: "agree", confidence: 0.7, rationale: "no analogs" },
  { lens: "policy_auditor", recommendedVerdict: "agree_with_concerns", confidence: 0.6, rationale: "minor policy gap" },
  { lens: "confidence_critic", recommendedVerdict: "agree", confidence: 0.65, rationale: "evidence sufficient" },
];

function makeReview(overrides: Partial<GovernanceReview> = {}): GovernanceReview {
  return {
    id: "review-prop-1-1700000000000",
    subject: "Governance review for prop-1",
    outcome: "reviewed",
    confidence: 0.7,
    reasons: ["council reached quorum"],
    generatedAt: "2026-06-22T00:00:00.000Z",
    recommendationId: "rec-prop-1-1700000000000",
    proposalId: "prop-1",
    verdict: "agree_with_concerns",
    concerns: ["minor policy gap"],
    blindSpots: [],
    historicalAnalogies: [],
    lensScores,
    councilVote,
    sourceArtifacts: [],
    ...overrides,
  };
}

async function seedReview(review: GovernanceReview): Promise<void> {
  const store = new GovernanceReviewStore();
  await store.append(review);
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

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe("decision outcome: governanceReviewId review store (P7.5p.3c)", () => {
  it("auto-looks up single stored review for proposal when no override", async () => {
    await seedReview(makeReview({ id: "review-1", proposalId: "prop-1" }));

    await handleDecisionCommand([
      "outcome",
      "record",
      "prop-1",
      "--outcome",
      "success",
    ]);

    const outcomes = readOutcomes();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].governanceReviewId).toBe("review-1");
  });

  it("--governance-review-id override wins when both store value and flag present", async () => {
    await seedReview(makeReview({ id: "review-1", proposalId: "prop-1" }));

    await handleDecisionCommand([
      "outcome",
      "record",
      "prop-1",
      "--outcome",
      "success",
      "--governance-review-id",
      "review-override",
    ]);

    const outcomes = readOutcomes();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].governanceReviewId).toBe("review-override");
  });

  it("no review in store AND no override → governanceReviewId === undefined (never faked)", async () => {
    // No seed — store empty.
    await handleDecisionCommand([
      "outcome",
      "record",
      "prop-1",
      "--outcome",
      "success",
    ]);

    const outcomes = readOutcomes();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].governanceReviewId).toBeUndefined();
  });

  it("no review in store AND --governance-review-id review-explicit → governanceReviewId === review-explicit", async () => {
    await handleDecisionCommand([
      "outcome",
      "record",
      "prop-1",
      "--outcome",
      "success",
      "--governance-review-id",
      "review-explicit",
    ]);

    const outcomes = readOutcomes();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].governanceReviewId).toBe("review-explicit");
  });

  it("multiple reviews same proposal, no override → auto-lookup picks latest appended (most recent)", async () => {
    await seedReview(
      makeReview({
        id: "review-first",
        proposalId: "prop-1",
        generatedAt: "2026-06-20T00:00:00.000Z",
      }),
    );
    await seedReview(
      makeReview({
        id: "review-latest",
        proposalId: "prop-1",
        generatedAt: "2026-06-22T00:00:00.000Z",
      }),
    );

    await handleDecisionCommand([
      "outcome",
      "record",
      "prop-1",
      "--outcome",
      "success",
    ]);

    const outcomes = readOutcomes();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].governanceReviewId).toBe("review-latest");
  });

  it("outcome for prop-2 with reviews only for prop-1 → governanceReviewId === undefined (proposal-scoped)", async () => {
    await seedReview(makeReview({ id: "review-1", proposalId: "prop-1" }));

    await handleDecisionCommand([
      "outcome",
      "record",
      "prop-2",
      "--outcome",
      "success",
    ]);

    const outcomes = readOutcomes();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].governanceReviewId).toBeUndefined();
  });

  it("cross-proposal isolation (governance-boundary invariant): prop-A links review-a NOT newer review-b for prop-B", async () => {
    // Seed older review for prop-A, then NEWER review for prop-B.
    // A naive list().at(-1) regression would return review-b (last appended)
    // and wrongly link it to prop-A's outcome.
    await seedReview(
      makeReview({
        id: "review-a",
        proposalId: "prop-A",
        generatedAt: "2026-06-20T00:00:00.000Z",
      }),
    );
    await seedReview(
      makeReview({
        id: "review-b",
        proposalId: "prop-B",
        generatedAt: "2026-06-22T00:00:00.000Z",
      }),
    );

    await handleDecisionCommand([
      "outcome",
      "record",
      "prop-A",
      "--outcome",
      "success",
    ]);

    const outcomes = readOutcomes();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].governanceReviewId).toBe("review-a");
    expect(outcomes[0].governanceReviewId).not.toBe("review-b");
  });
});
