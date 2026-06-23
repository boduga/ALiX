import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GovernanceReviewStore } from "../../src/adaptation/governance-review-store.js";
import type { GovernanceReview, LensScore, CouncilVote } from "../../src/adaptation/governance-review-types.js";

let cwdSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "review-store-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
});

afterEach(() => {
  cwdSpy.mockRestore();
  rmSync(tempRoot, { recursive: true, force: true });
});

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

describe("GovernanceReviewStore: append + query", () => {
  it("appends a review and persists as one JSONL line", async () => {
    const store = new GovernanceReviewStore();
    await store.append(makeReview({ id: "review-1" }));
    const path = join(tempRoot, ".alix", "governance-reviews", "governance-reviews.jsonl");
    const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.id).toBe("review-1");
    expect(parsed.proposalId).toBe("prop-1");
    expect(parsed.lensScores).toHaveLength(4);
  });

  it("get(id) returns the stored review", async () => {
    const store = new GovernanceReviewStore();
    await store.append(makeReview({ id: "review-42", verdict: "challenge" }));
    const got = await store.get("review-42");
    expect(got).not.toBeNull();
    expect(got!.verdict).toBe("challenge");
  });

  it("get(id) returns null for an unknown id", async () => {
    const store = new GovernanceReviewStore();
    const got = await store.get("nonexistent");
    expect(got).toBeNull();
  });

  it("list() returns all stored reviews", async () => {
    const store = new GovernanceReviewStore();
    await store.append(makeReview({ id: "review-1" }));
    await store.append(makeReview({ id: "review-2" }));
    const all = await store.list();
    expect(all.map((r) => r.id).sort()).toEqual(["review-1", "review-2"]);
  });

  it("queryByWindow(days) returns only reviews within the window", async () => {
    const store = new GovernanceReviewStore();
    const now = new Date();
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    const fortyDaysAgo = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);
    await store.append(makeReview({ id: "recent", generatedAt: tenDaysAgo.toISOString() }));
    await store.append(makeReview({ id: "old", generatedAt: fortyDaysAgo.toISOString() }));
    const inWindow = await store.queryByWindow(30);
    expect(inWindow.map((r) => r.id)).toEqual(["recent"]);
  });

  it("queryByProposal(proposalId) returns only reviews for that proposal", async () => {
    const store = new GovernanceReviewStore();
    await store.append(makeReview({ id: "review-1", proposalId: "prop-1" }));
    await store.append(makeReview({ id: "review-2", proposalId: "prop-2" }));
    await store.append(makeReview({ id: "review-3", proposalId: "prop-1" }));
    const forProp1 = await store.queryByProposal("prop-1");
    expect(forProp1.map((r) => r.id)).toEqual(["review-1", "review-3"]);
  });

  it("queryByProposal returns reviews in append order (last = most recent)", async () => {
    const store = new GovernanceReviewStore();
    await store.append(makeReview({ id: "review-first", proposalId: "prop-1", generatedAt: "2026-06-20T00:00:00.000Z" }));
    await store.append(makeReview({ id: "review-latest", proposalId: "prop-1", generatedAt: "2026-06-22T00:00:00.000Z" }));
    const forProp1 = await store.queryByProposal("prop-1");
    // The caller picks the last element as "most recent".
    expect(forProp1[forProp1.length - 1].id).toBe("review-latest");
  });
});

describe("GovernanceReviewStore: append-only + no source mutation", () => {
  it("prototype has no delete/update/clear/truncate/set/replace/modifySource/writeBack methods", () => {
    const store = new GovernanceReviewStore();
    const proto = Object.getPrototypeOf(store) as Record<string, unknown>;
    for (const forbidden of [
      "delete", "update", "clear", "truncate",
      "set", "replace", "modifySource", "writeBack",
    ]) {
      expect(typeof proto[forbidden]).not.toBe("function");
    }
  });

  it("appending the same id twice does NOT overwrite — both lines are kept", async () => {
    const store = new GovernanceReviewStore();
    await store.append(makeReview({ id: "review-dup", verdict: "agree" }));
    await store.append(makeReview({ id: "review-dup", verdict: "challenge" }));
    const path = join(tempRoot, ".alix", "governance-reviews", "governance-reviews.jsonl");
    const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
  });
});

describe("GovernanceReviewStore: corrupt-line skip", () => {
  it("skips malformed lines when reading back", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const dir = join(tempRoot, ".alix", "governance-reviews");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "governance-reviews.jsonl"),
      JSON.stringify(makeReview({ id: "good" })) + "\n" + "{ not valid json\n",
    );
    const store = new GovernanceReviewStore();
    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("good");
  });
});
