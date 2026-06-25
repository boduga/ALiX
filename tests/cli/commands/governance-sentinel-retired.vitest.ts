/**
 * P8.5a.2c — Sentinel retirement test for `lens_scores_not_persisted`.
 *
 * Asserts two invariants:
 * 1. Running the lens-calibration CLI path (`alix outcome lens-calibration`)
 *    against seeded GovernanceReviewStore + OutcomeStore returns a LIVE
 *    LensCalibrationReport (with populated `lenses` reflecting the seeded
 *    reviews) — NOT the historical sentinel object.
 * 2. Grepping the codebase confirms `lens_scores_not_persisted` no longer
 *    appears anywhere in `src/` or `tests/`.
 *
 * Mirror the temp-dir + vi.spyOn(process, "cwd") pattern used by the
 * other decision CLI tests in this directory.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { readdirSync, readFileSync as readFileRecursive } from "node:fs";
import { statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { execSync } from "node:child_process";
import { handleDecisionCommand } from "../../../src/cli/commands/decision.js";

/**
 * Repo root resolved from this test file's location (tests/cli/commands/).
 * Captured at module load time — before beforeEach mocks process.cwd().
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
import { GovernanceReviewStore } from "../../../src/adaptation/governance-review-store.js";
import type {
  GovernanceReview,
  LensScore,
  CouncilVote,
} from "../../../src/adaptation/governance-review-types.js";
import { OutcomeStore } from "../../../src/adaptation/outcome-store.js";
import type { OutcomeRecord } from "../../../src/adaptation/outcome-types.js";
import type { LensCalibrationReport } from "../../../src/adaptation/outcome-types.js";

let cwdSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "gov-sentinel-"));
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
// Fixtures
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

function makeOutcome(overrides: Partial<OutcomeRecord> = {}): OutcomeRecord {
  return {
    id: "out-1",
    subject: "Outcome for prop-1",
    outcome: "success",
    confidence: 0.7,
    reasons: ["fixture"],
    generatedAt: "2026-06-22T00:00:00.000Z",
    subjectId: "prop-1",
    subjectType: "proposal",
    actionTaken: "Applied",
    observationWindowDays: 7,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Walk a directory tree, returning all .ts files. Used to grep for the
// sentinel string across src/ and tests/.
// ---------------------------------------------------------------------------

function walkTsFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const p = join(root, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      out.push(...walkTsFiles(p));
    } else if (entry.endsWith(".ts")) {
      out.push(p);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("P8.5a.2c — lens_scores_not_persisted sentinel retired", () => {
  it("CLI lens-calibration path returns a LIVE LensCalibrationReport (not the sentinel object)", async () => {
    // Seed: 1 review (4 lensScores) + 1 outcome for prop-1.
    const reviewStore = new GovernanceReviewStore();
    await reviewStore.append(makeReview({ id: "review-live", proposalId: "prop-1" }));

    const outcomeStore = new OutcomeStore(join(tempRoot, ".alix", "adaptation", "outcomes"));
    await outcomeStore.append(makeOutcome({ id: "out-live", subjectId: "prop-1" }));

    // Capture the JSON output of the CLI command.
    let captured = "";
    logSpy.mockImplementation((...args: unknown[]) => {
      captured += args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    });

    await handleDecisionCommand([
      "outcome",
      "lens-calibration",
      "--json",
      "--window",
      "30",
    ]);

    // Should be valid JSON.
    const parsed = JSON.parse(captured);

    // Sentinel object had a `status: "lens_scores_not_persisted"` field.
    // Live report must NOT carry that.
    expect(parsed.status).toBeUndefined();

    // Live report shape: { windowDays, lenses: { ... } } — lens report fields.
    const report = parsed as LensCalibrationReport;
    expect(report.windowDays).toBe(30);
    expect(report.lenses).toBeDefined();
    expect(report.lenses.red_team).toBeDefined();
    expect(report.lenses.historian).toBeDefined();
    expect(report.lenses.policy_auditor).toBeDefined();
    expect(report.lenses.confidence_critic).toBeDefined();

    // 4 observations (1 review × 4 lensScores) → all 4 lenses see 1 review each.
    expect(report.lenses.red_team.reviewsAnalyzed).toBe(1);
    expect(report.lenses.historian.reviewsAnalyzed).toBe(1);
    expect(report.lenses.policy_auditor.reviewsAnalyzed).toBe(1);
    expect(report.lenses.confidence_critic.reviewsAnalyzed).toBe(1);

    // red_team warned ("challenge" → concernsRaised=1, outcome=success → falseAlarm).
    expect(report.lenses.red_team.falseAlarms).toBe(1);

    // historian agreed (no warning) → no false alarm, no miss.
    expect(report.lenses.historian.falseAlarms).toBe(0);
    expect(report.lenses.historian.missedFailures).toBe(0);
  });

  it("grep confirms 'lens_scores_not_persisted' no longer appears anywhere in src/", () => {
    const repoRoot = REPO_ROOT;
    const srcFiles = walkTsFiles(join(repoRoot, "src"));

    let hits = 0;
    for (const f of srcFiles) {
      const txt = readFileRecursive(f, "utf-8");
      if (txt.includes("lens_scores_not_persisted")) {
        hits += 1;
      }
    }
    expect(hits).toBe(0);
  });

  it("grep confirms 'lens_scores_not_persisted' no longer appears anywhere in tests/ (excluding this file)", () => {
    const repoRoot = REPO_ROOT;
    const testFiles = walkTsFiles(join(repoRoot, "tests")).filter(
      (f) => !f.endsWith("governance-sentinel-retired.vitest.ts"),
    );

    let hits = 0;
    for (const f of testFiles) {
      const txt = readFileRecursive(f, "utf-8");
      if (txt.includes("lens_scores_not_persisted")) {
        hits += 1;
      }
    }
    expect(hits).toBe(0);
  });

  it("system grep -rn confirms 'lens_scores_not_persisted' returns empty across src/ and tests/ (excluding this file)", () => {
    // Last-line guarantee: a real shell-level grep, excluding this test file
    // (which legitimately references the sentinel name in its assertions).
    let stdout = "";
    try {
      stdout = execSync(
        'grep -rn --exclude="governance-sentinel-retired.vitest.ts" "lens_scores_not_persisted" src/ tests/ || true',
        { cwd: REPO_ROOT },
      ).toString();
    } catch {
      stdout = "";
    }
    expect(stdout.trim()).toBe("");
  });
});