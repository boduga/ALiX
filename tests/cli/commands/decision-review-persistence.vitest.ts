/**
 * P7.5p.3b — CLI hook contract test: runReview persists GovernanceReview.
 *
 * Strategy: (b) behavioral contract test.
 *
 * Rationale: runReview is LLM-gated. It calls detectProvider(), reads a
 * provider API key from process.env, constructs a ProviderCatalogAdapter,
 * and runs 4 LLMLensAgent instances in parallel via Promise.all before
 * reaching the post-aggregate write hook. Driving a full end-to-end
 * invocation of runReview in a unit test would require mocking the provider
 * factory, the LLM adapter, all four lens agents, buildDecisionInfrastructure,
 * RecommendationEngine, and RiskScoreBuilder — at which point the test would
 * be asserting mock behavior, not the persistence contract that P7.5p.3b
 * introduces. The P7.5p.2b test could invoke runRecommend end-to-end because
 * runRecommend is deterministic (no LLM calls); runReview is not.
 *
 * What this test therefore locks in is the behavioral guarantee of the
 * write hook inserted in runReview between council.aggregate(...) and the
 * render block:
 *
 *   await new GovernanceReviewStore().append(review).catch((err) =>
 *     console.warn(`Warning: failed to persist governance review ...`, ...),
 *   );
 *
 * The contract has two clauses:
 * 1. Persistence — append persists the review verbatim as one JSONL line.
 * 2. Best-effort failure — append wrapped in .catch emits a warning on
 *    failure and does NOT re-throw (the render path is never blocked).
 *
 * Order invariant (locked by reading decision.ts, not re-asserted here):
 * lens-run → aggregate → append → render.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GovernanceReviewStore } from "../../../src/adaptation/governance-review-store.js";
import type {
  GovernanceReview,
  LensScore,
  CouncilVote,
} from "../../../src/adaptation/governance-review-types.js";

// ---------------------------------------------------------------------------
// process.cwd override — store resolves under a per-test temp root.
// ---------------------------------------------------------------------------

let tempRoot: string;
let cwdSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "decision-review-persist-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
});

afterEach(() => {
  cwdSpy.mockRestore();
  rmSync(tempRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixture — a full GovernanceReview with 4 lens scores.
// ---------------------------------------------------------------------------

const lensScores: LensScore[] = [
  { lens: "red_team", recommendedVerdict: "challenge", confidence: 0.8, rationale: "high risk" },
  { lens: "historian", recommendedVerdict: "agree", confidence: 0.7, rationale: "no analogs" },
  { lens: "policy_auditor", recommendedVerdict: "agree_with_concerns", confidence: 0.6, rationale: "minor policy gap" },
  { lens: "confidence_critic", recommendedVerdict: "agree", confidence: 0.65, rationale: "evidence sufficient" },
];

const councilVote: CouncilVote = {
  agree: 2,
  agreeWithConcerns: 1,
  challenge: 1,
  insufficientInformation: 0,
};

function makeReview(overrides: Partial<GovernanceReview> = {}): GovernanceReview {
  return {
    id: "review-prop-1-1700000000000",
    subject: "Governance review prop-1",
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("decision review persists GovernanceReview (P7.5p.3b)", () => {
  it("append persists the review as one JSONL line (id + lensScores.length === 4)", async () => {
    const review = makeReview({ id: "review-prop-1-1" });
    const store = new GovernanceReviewStore();

    // This is the exact call shape the runReview hook makes, minus the
    // .catch (success path — no rejection to absorb).
    await store.append(review);

    const path = join(tempRoot, ".alix", "governance-reviews", "governance-reviews.jsonl");
    expect(existsSync(path)).toBe(true);

    const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]) as GovernanceReview;
    expect(parsed.id).toBe("review-prop-1-1");
    expect(parsed.proposalId).toBe("prop-1");
    expect(parsed.lensScores).toHaveLength(4);
    // Verbatim round-trip — store must not mutate the review.
    expect(parsed.verdict).toBe("agree_with_concerns");
    expect(parsed.councilVote).toEqual(councilVote);
  });

  it("best-effort failure: .catch handler emits a warning and does NOT re-throw (render path unblocked)", async () => {
    // Mock GovernanceReviewStore.append to reject, simulating the failure
    // path the runReview hook must absorb.
    const appendSpy = vi
      .spyOn(GovernanceReviewStore.prototype, "append")
      .mockRejectedValue(new Error("disk full"));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      // Reproduce the exact hook expression from runReview. The assertion is
      // that this expression settles (does not throw) and that the warning
      // was emitted — i.e. the render block immediately after it would run.
      const review = makeReview({ id: "review-prop-1-2" });
      const reviewId = review.id;

      let threw = false;
      try {
        await new GovernanceReviewStore().append(review).catch((err) =>
          console.warn(
            `Warning: failed to persist governance review ${reviewId}:`,
            err instanceof Error ? err.message : String(err),
          ),
        );
      } catch {
        threw = true;
      }

      expect(threw).toBe(false);
      expect(appendSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      // Warning message includes the review id and the error text.
      const warnArg = String(warnSpy.mock.calls[0].join(" "));
      expect(warnArg).toContain("review-prop-1-2");
      expect(warnArg).toContain("disk full");
    } finally {
      appendSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
