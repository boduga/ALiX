/**
 * P9.0e — LensLifecycleReview tests.
 *
 * 4 tests:
 *   1. Empty store — returns empty lensReviews array.
 *   2. Lens with PV > 0.7 and > 20 reviews → promote.
 *   3. Lens with PV < 0.2 and > 30 reviews → retire.
 *   4. Lens with moderate PV → keep.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { reviewLenses } from "../../src/governance/governance-lens-review.js";
import { LearningStore } from "../../src/learning/learning-store.js";
import type { CalibrationProfile } from "../../src/learning/learning-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LEARNING_DIR = join(".alix", "learning");

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let cwdSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "gov-lens-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
});

afterEach(() => {
  cwdSpy.mockRestore();
  rmSync(tempRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function recentISO(offsetMinutes = 0): string {
  return new Date(Date.now() - offsetMinutes * 60_000).toISOString();
}

/**
 * Create a minimal calibration profile for a governance lens.
 * `confidence` serves as the predictive value.
 * `signalCount` determines reviewsAnalyzed via sourceSignalIds.length.
 */
function seedLensProfile(opts: {
  id: string;
  lensName: string;
  confidence: number;
  signalCount: number;
  offsetMinutes?: number;
  reason?: string;
}): CalibrationProfile {
  const sourceSignalIds: string[] = Array.from(
    { length: opts.signalCount },
    (_, i) => `ls:${opts.id}-sig-${i}`,
  );

  return {
    id: opts.id,
    subject: "Lens calibration",
    outcome: "profile_generated",
    confidence: opts.confidence,
    reasons: ["signal-based"],
    generatedAt: recentISO(opts.offsetMinutes ?? 0),
    target: "governance_lens_weight",
    targetName: opts.lensName,
    previousValue: 0.5,
    suggestedValue: opts.confidence,
    reason: opts.reason ?? "Calibrated from signals",
    evidenceRefs: [],
    sourceSignalIds,
  };
}

/** Write profiles to the LearningStore in the temp directory. */
async function seedProfiles(profiles: CalibrationProfile[]): Promise<void> {
  const storeDir = join(tempRoot, LEARNING_DIR);
  mkdirSync(storeDir, { recursive: true });
  const store = new LearningStore(storeDir);
  for (const p of profiles) {
    await store.appendProfile(p);
  }
}

// ---------------------------------------------------------------------------
// Test 1: Empty store
// ---------------------------------------------------------------------------

describe("reviewLenses", () => {
  it("returns empty lensReviews array when no calibration data exists", async () => {
    const review = await reviewLenses({
      cwd: tempRoot,
      windowDays: 90,
      generatedAt: "2026-06-23T00:00:00.000Z",
    });

    expect(review.reportType).toBe("lens_lifecycle");
    expect(review.lensReviews).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Test 2: High PV + sufficient reviews → promote
  // ---------------------------------------------------------------------------

  it("recommends promote when PV > 0.7 and reviewsAnalyzed > 20", async () => {
    // Seed a red_team profile with confidence=0.85 and 21 signal IDs
    await seedProfiles([
      seedLensProfile({
        id: "cp-promote",
        lensName: "red_team",
        confidence: 0.85,
        signalCount: 21,
      }),
    ]);

    const review = await reviewLenses({
      cwd: tempRoot,
      windowDays: 90,
      generatedAt: "2026-06-23T00:00:00.000Z",
    });

    // Should have entries for all 4 lenses (non-matching ones get "keep")
    expect(review.lensReviews.length).toBe(4);

    const redTeam = review.lensReviews.find((r) => r.lens === "red_team")!;
    expect(redTeam).toBeDefined();
    expect(redTeam.predictiveValue).toBe(0.85);
    expect(redTeam.reviewsAnalyzed).toBe(21);
    expect(redTeam.recommendation).toBe("promote");
    expect(redTeam.reason).toContain("High predictive value");

    // Other lenses without data should be "keep"
    const historian = review.lensReviews.find((r) => r.lens === "historian")!;
    expect(historian.recommendation).toBe("keep");
    expect(historian.predictiveValue).toBe(0);
    expect(historian.reviewsAnalyzed).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Test 3: Very low PV + many reviews → retire
  // ---------------------------------------------------------------------------

  it("recommends retire when PV < 0.2 and reviewsAnalyzed > 30", async () => {
    // Seed a historian profile with confidence=0.12 and 31 signal IDs
    await seedProfiles([
      seedLensProfile({
        id: "cp-retire",
        lensName: "historian",
        confidence: 0.12,
        signalCount: 31,
      }),
    ]);

    const review = await reviewLenses({
      cwd: tempRoot,
      windowDays: 90,
      generatedAt: "2026-06-23T00:00:00.000Z",
    });

    const historian = review.lensReviews.find((r) => r.lens === "historian")!;
    expect(historian).toBeDefined();
    expect(historian.predictiveValue).toBe(0.12);
    expect(historian.reviewsAnalyzed).toBe(31);
    expect(historian.recommendation).toBe("retire");
    expect(historian.reason).toContain("Very low predictive value");
  });

  // ---------------------------------------------------------------------------
  // Test 4: Moderate PV → keep
  // ---------------------------------------------------------------------------

  it("recommends keep for moderate PV", async () => {
    // Seed a policy_auditor profile with moderate confidence=0.55 and only 5 signals
    await seedProfiles([
      seedLensProfile({
        id: "cp-moderate",
        lensName: "policy_auditor",
        confidence: 0.55,
        signalCount: 5,
      }),
    ]);

    const review = await reviewLenses({
      cwd: tempRoot,
      windowDays: 90,
      generatedAt: "2026-06-23T00:00:00.000Z",
    });

    const policyAuditor = review.lensReviews.find(
      (r) => r.lens === "policy_auditor",
    )!;
    expect(policyAuditor).toBeDefined();
    expect(policyAuditor.predictiveValue).toBe(0.55);
    expect(policyAuditor.reviewsAnalyzed).toBe(5);
    expect(policyAuditor.recommendation).toBe("keep");
    expect(policyAuditor.reason).toContain("Stable performance");
    expect(policyAuditor.reason).toContain("PV=0.55");
  });
});
