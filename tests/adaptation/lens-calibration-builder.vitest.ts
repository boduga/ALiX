/**
 * P7c — LensCalibrationBuilder tests.
 *
 * Covers: all-agree-success, lens-warns-failure-validated, lens-warns-success-false-alarm,
 * lens-agrees-failure-missed-failure, mixed-observations, all-unknown-insufficient-data,
 * single-lens, determinism, empty-input, agree-with-concerns, challenge verdicts,
 * neutral outcomes.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { LensCalibrationBuilder } from "../../src/adaptation/lens-calibration-builder.js";
import type { LensObservation } from "../../src/adaptation/lens-calibration-builder.js";
import type { LensName } from "../../src/adaptation/governance-review-types.js";
import type { GovernanceVerdict } from "../../src/adaptation/governance-review-types.js";
import type { OutcomeValue } from "../../src/adaptation/outcome-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function obs(overrides: Partial<LensObservation> = {}): LensObservation {
  return {
    lens: "red_team",
    verdict: "agree",
    outcome: "success",
    concernsRaised: 0,
    ...overrides,
  };
}

const ALL_LENSES: LensName[] = ["red_team", "historian", "policy_auditor", "confidence_critic"];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LensCalibrationBuilder", () => {
  const builder = new LensCalibrationBuilder();

  // -----------------------------------------------------------------------
  // Empty input
  // -----------------------------------------------------------------------

  describe("empty observations", () => {
    it("returns insufficient_data for all lenses", () => {
      const report = builder.build([]);

      expect(report.windowDays).toBe(30);
      expect(report.confidence).toBe(0);

      for (const lens of ALL_LENSES) {
        const entry = report.lenses[lens];
        expect(entry.reviewsAnalyzed).toBe(0);
        expect(entry.concernsRaised).toBe(0);
        expect(entry.concernsValidated).toBe(0);
        expect(entry.falseAlarms).toBe(0);
        expect(entry.missedFailures).toBe(0);
        expect(entry.predictiveValue).toBe(0);
        expect(entry.calibration).toBe("insufficient_data");
      }

      expect(report.reasons.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // All lenses agree, all success → high predictiveValue? No — concernsRaised is 0 so predictiveValue is 0.
  // But this is still a useful scenario: lenses didn't raise concerns, everything succeeded.
  // -----------------------------------------------------------------------

  describe("all lenses agree, all outcomes success", () => {
    it("has zero concerns raised and insufficient_data calibration", () => {
      const observations: LensObservation[] = ALL_LENSES.flatMap((lens) => [
        obs({ lens, verdict: "agree", outcome: "success", concernsRaised: 0 }),
        obs({ lens, verdict: "agree", outcome: "success", concernsRaised: 0 }),
      ]);

      const report = builder.build(observations);

      // 8 observations (2 per lens)
      for (const lens of ALL_LENSES) {
        const entry = report.lenses[lens];
        expect(entry.reviewsAnalyzed).toBe(2);
        expect(entry.concernsRaised).toBe(0);
        expect(entry.concernsValidated).toBe(0);
        expect(entry.falseAlarms).toBe(0);
        expect(entry.missedFailures).toBe(0);
        expect(entry.predictiveValue).toBe(0);
        expect(entry.calibration).toBe("insufficient_data");
      }
    });
  });

  // -----------------------------------------------------------------------
  // Lens warns, outcome fails → validated
  // -----------------------------------------------------------------------

  describe("lens warns and outcome fails", () => {
    it("validates concerns", () => {
      const observations: LensObservation[] = [
        obs({ lens: "red_team", verdict: "challenge", outcome: "failure", concernsRaised: 5 }),
      ];

      const report = builder.build(observations);

      const entry = report.lenses.red_team;
      expect(entry.reviewsAnalyzed).toBe(1);
      expect(entry.concernsRaised).toBe(5);
      expect(entry.concernsValidated).toBe(5);
      expect(entry.falseAlarms).toBe(0);
      expect(entry.missedFailures).toBe(0);
      expect(entry.predictiveValue).toBe(1);
      expect(entry.calibration).toBe("strong");
    });
  });

  // -----------------------------------------------------------------------
  // Lens warns, outcome succeeds → false alarm
  // -----------------------------------------------------------------------

  describe("lens warns but outcome succeeds", () => {
    it("counts as false alarm", () => {
      const observations: LensObservation[] = [
        obs({ lens: "red_team", verdict: "challenge", outcome: "success", concernsRaised: 3 }),
      ];

      const report = builder.build(observations);

      const entry = report.lenses.red_team;
      expect(entry.reviewsAnalyzed).toBe(1);
      expect(entry.concernsRaised).toBe(3);
      expect(entry.concernsValidated).toBe(0);
      expect(entry.falseAlarms).toBe(1);
      expect(entry.missedFailures).toBe(0);
      expect(entry.predictiveValue).toBe(0); // 0/3
      expect(entry.calibration).toBe("insufficient_data");
    });
  });

  // -----------------------------------------------------------------------
  // Lens warns (agree_with_concerns), outcome succeeds → false alarm
  // -----------------------------------------------------------------------

  describe("lens agree_with_concerns and outcome succeeds", () => {
    it("counts as false alarm", () => {
      const observations: LensObservation[] = [
        obs({ lens: "historian", verdict: "agree_with_concerns", outcome: "partial_success", concernsRaised: 2 }),
      ];

      const report = builder.build(observations);

      const entry = report.lenses.historian;
      expect(entry.reviewsAnalyzed).toBe(1);
      expect(entry.concernsRaised).toBe(2);
      expect(entry.concernsValidated).toBe(0);
      expect(entry.falseAlarms).toBe(1);
      expect(entry.missedFailures).toBe(0);
      expect(entry.predictiveValue).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Lens agrees, outcome fails → missed failure
  // -----------------------------------------------------------------------

  describe("lens agrees but outcome fails", () => {
    it("counts as missed failure", () => {
      const observations: LensObservation[] = [
        obs({ lens: "red_team", verdict: "agree", outcome: "failure", concernsRaised: 0 }),
      ];

      const report = builder.build(observations);

      const entry = report.lenses.red_team;
      expect(entry.reviewsAnalyzed).toBe(1);
      expect(entry.concernsRaised).toBe(0);
      expect(entry.concernsValidated).toBe(0);
      expect(entry.falseAlarms).toBe(0);
      expect(entry.missedFailures).toBe(1);
      expect(entry.predictiveValue).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Lens insufficient_information, outcome fails → missed failure
  // -----------------------------------------------------------------------

  describe("lens insufficient_information and outcome fails", () => {
    it("counts as missed failure (did not warn)", () => {
      const observations: LensObservation[] = [
        obs({ lens: "policy_auditor", verdict: "insufficient_information", outcome: "failure", concernsRaised: 1 }),
      ];

      const report = builder.build(observations);

      const entry = report.lenses.policy_auditor;
      expect(entry.reviewsAnalyzed).toBe(1);
      // insufficient_information is NOT a warning verdict, so concernsRaised is not added
      expect(entry.concernsRaised).toBe(0);
      expect(entry.concernsValidated).toBe(0);
      expect(entry.falseAlarms).toBe(0);
      expect(entry.missedFailures).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Mixed observations across lenses
  // -----------------------------------------------------------------------

  describe("mixed observations across lenses", () => {
    it("computes correct per-lens calibration", () => {
      const observations: LensObservation[] = [
        // red_team: 2 warns validated, 1 false alarm
        obs({ lens: "red_team", verdict: "challenge", outcome: "failure", concernsRaised: 4 }),
        obs({ lens: "red_team", verdict: "challenge", outcome: "failure", concernsRaised: 2 }),
        obs({ lens: "red_team", verdict: "agree_with_concerns", outcome: "success", concernsRaised: 1 }),

        // historian: 1 agree missed failure, 1 agree success (no impact)
        obs({ lens: "historian", verdict: "agree", outcome: "failure", concernsRaised: 0 }),
        obs({ lens: "historian", verdict: "agree", outcome: "success", concernsRaised: 0 }),

        // policy_auditor: empty
        // (no observations)

        // confidence_critic: 1 warn validated (strong), 1 agree success
        obs({ lens: "confidence_critic", verdict: "challenge", outcome: "failure", concernsRaised: 3 }),
        obs({ lens: "confidence_critic", verdict: "agree", outcome: "success", concernsRaised: 0 }),
      ];

      const report = builder.build(observations);

      // red_team: 3 reviews, concernsRaised = 4+2+1 = 7, validated = 4+2 = 6, falseAlarms = 1
      const rt = report.lenses.red_team;
      expect(rt.reviewsAnalyzed).toBe(3);
      expect(rt.concernsRaised).toBe(7);
      expect(rt.concernsValidated).toBe(6);
      expect(rt.falseAlarms).toBe(1);
      expect(rt.missedFailures).toBe(0);
      expect(rt.predictiveValue).toBeCloseTo(6 / 7, 10);
      expect(rt.calibration).toBe("strong"); // 0.857 >= 0.7

      // historian: 2 reviews, 0 concerns, 1 missed failure
      const hist = report.lenses.historian;
      expect(hist.reviewsAnalyzed).toBe(2);
      expect(hist.concernsRaised).toBe(0);
      expect(hist.missedFailures).toBe(1);
      expect(hist.predictiveValue).toBe(0);
      expect(hist.calibration).toBe("insufficient_data");

      // policy_auditor: 0 reviews
      const pol = report.lenses.policy_auditor;
      expect(pol.reviewsAnalyzed).toBe(0);
      expect(pol.calibration).toBe("insufficient_data");

      // confidence_critic: 2 reviews, concernsRaised = 3, validated = 3, 0 false alarms
      const cc = report.lenses.confidence_critic;
      expect(cc.reviewsAnalyzed).toBe(2);
      expect(cc.concernsRaised).toBe(3);
      expect(cc.concernsValidated).toBe(3);
      expect(cc.falseAlarms).toBe(0);
      expect(cc.missedFailures).toBe(0);
      expect(cc.predictiveValue).toBeCloseTo(1, 10);
      expect(cc.calibration).toBe("strong");
    });
  });

  // -----------------------------------------------------------------------
  // All unknown outcomes → insufficient_data for all lenses
  // -----------------------------------------------------------------------

  describe("all unknown outcomes", () => {
    it("produces insufficient_data for all lenses", () => {
      const observations: LensObservation[] = ALL_LENSES.map((lens) =>
        obs({ lens, verdict: "challenge", outcome: "unknown", concernsRaised: 3 }),
      );

      const report = builder.build(observations);

      for (const lens of ALL_LENSES) {
        const entry = report.lenses[lens];
        expect(entry.reviewsAnalyzed).toBe(1);
        expect(entry.concernsRaised).toBe(3); // warned, so concerns counted
        expect(entry.concernsValidated).toBe(0); // outcome not failure
        expect(entry.falseAlarms).toBe(0); // outcome not success/partial_success
        expect(entry.missedFailures).toBe(0); // lens warned, so not missed
        expect(entry.predictiveValue).toBe(0); // 0/3
        expect(entry.calibration).toBe("insufficient_data");
      }
    });
  });

  // -----------------------------------------------------------------------
  // Single lens observations
  // -----------------------------------------------------------------------

  describe("single lens observations", () => {
    it("only populates the target lens, others empty", () => {
      const observations: LensObservation[] = [
        obs({ lens: "red_team", verdict: "challenge", outcome: "failure", concernsRaised: 2 }),
        obs({ lens: "red_team", verdict: "agree", outcome: "success", concernsRaised: 0 }),
      ];

      const report = builder.build(observations);

      expect(report.lenses.red_team.reviewsAnalyzed).toBe(2);
      expect(report.lenses.historian.reviewsAnalyzed).toBe(0);
      expect(report.lenses.policy_auditor.reviewsAnalyzed).toBe(0);
      expect(report.lenses.confidence_critic.reviewsAnalyzed).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Determinism
  // -----------------------------------------------------------------------

  describe("determinism", () => {
    it("produces identical output for identical inputs", () => {
      const observations: LensObservation[] = [
        obs({ lens: "red_team", verdict: "challenge", outcome: "failure", concernsRaised: 3 }),
        obs({ lens: "historian", verdict: "agree", outcome: "success", concernsRaised: 0 }),
        obs({ lens: "policy_auditor", verdict: "agree_with_concerns", outcome: "partial_success", concernsRaised: 2 }),
        obs({ lens: "confidence_critic", verdict: "challenge", outcome: "failure", concernsRaised: 1 }),
        obs({ lens: "red_team", verdict: "agree", outcome: "failure", concernsRaised: 0 }),
      ];

      const report1 = builder.build(observations, {
        windowDays: 45,
        generatedAt: "2026-01-15T12:00:00.000Z",
      });

      const report2 = builder.build(
        observations.map((o) => ({ ...o })), // shallow copy
        {
          windowDays: 45,
          generatedAt: "2026-01-15T12:00:00.000Z",
        },
      );

      // Deep-equal via JSON roundtrip (ignores id which has timestamp)
      const { id: _id1, ...rest1 } = report1;
      const { id: _id2, ...rest2 } = report2;
      expect(rest1).toEqual(rest2);
    });
  });

  // -----------------------------------------------------------------------
  // Predictive value calibration tiers
  // -----------------------------------------------------------------------

  describe("calibration tier thresholds", () => {
    it("strong: predictiveValue >= 0.7", () => {
      // 7 validated out of 10 raised = 0.7 exactly
      const observations: LensObservation[] = [
        obs({ lens: "red_team", verdict: "challenge", outcome: "failure", concernsRaised: 7 }),
        obs({ lens: "red_team", verdict: "agree_with_concerns", outcome: "success", concernsRaised: 3 }),
      ];
      const report = builder.build(observations);
      expect(report.lenses.red_team.predictiveValue).toBeCloseTo(0.7, 10);
      expect(report.lenses.red_team.calibration).toBe("strong");
    });

    it("moderate: predictiveValue >= 0.4", () => {
      const observations: LensObservation[] = [
        obs({ lens: "red_team", verdict: "challenge", outcome: "failure", concernsRaised: 4 }),
        obs({ lens: "red_team", verdict: "agree_with_concerns", outcome: "success", concernsRaised: 6 }),
      ];
      const report = builder.build(observations);
      expect(report.lenses.red_team.predictiveValue).toBeCloseTo(0.4, 10);
      expect(report.lenses.red_team.calibration).toBe("moderate");
    });

    it("weak: predictiveValue >= 0.1", () => {
      const observations: LensObservation[] = [
        obs({ lens: "red_team", verdict: "challenge", outcome: "failure", concernsRaised: 1 }),
        obs({ lens: "red_team", verdict: "agree_with_concerns", outcome: "success", concernsRaised: 9 }),
      ];
      const report = builder.build(observations);
      expect(report.lenses.red_team.predictiveValue).toBeCloseTo(0.1, 10);
      expect(report.lenses.red_team.calibration).toBe("weak");
    });

    it("insufficient_data: predictiveValue < 0.1 with reviews", () => {
      const observations: LensObservation[] = [
        obs({ lens: "red_team", verdict: "challenge", outcome: "failure", concernsRaised: 0 }),
        obs({ lens: "red_team", verdict: "agree_with_concerns", outcome: "success", concernsRaised: 10 }),
      ];
      const report = builder.build(observations);
      expect(report.lenses.red_team.predictiveValue).toBe(0);
      expect(report.lenses.red_team.calibration).toBe("insufficient_data");
    });
  });

  // -----------------------------------------------------------------------
  // Custom windowDays and generatedAt
  // -----------------------------------------------------------------------

  describe("custom options", () => {
    it("uses provided windowDays", () => {
      const report = builder.build([], { windowDays: 90 });
      expect(report.windowDays).toBe(90);
    });

    it("uses provided generatedAt", () => {
      const ts = "2026-01-15T00:00:00.000Z";
      const report = builder.build([], { generatedAt: ts });
      expect(report.generatedAt).toBe(ts);
    });

    it("defaults windowDays to 30 and generatedAt to current time", () => {
      const before = new Date().toISOString();
      const report = builder.build([]);
      const after = new Date().toISOString();
      expect(report.windowDays).toBe(30);
      expect(report.generatedAt >= before).toBe(true);
      expect(report.generatedAt <= after).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Neutral outcomes
  // -----------------------------------------------------------------------

  describe("neutral outcomes", () => {
    it("lens warns but outcome neutral — no false alarm, no validation", () => {
      const observations: LensObservation[] = [
        obs({ lens: "red_team", verdict: "challenge", outcome: "neutral", concernsRaised: 4 }),
        obs({ lens: "red_team", verdict: "agree", outcome: "neutral", concernsRaised: 0 }),
      ];

      const report = builder.build(observations);

      const entry = report.lenses.red_team;
      expect(entry.reviewsAnalyzed).toBe(2);
      expect(entry.concernsRaised).toBe(4); // warned, so concerns counted
      expect(entry.concernsValidated).toBe(0); // not failure
      expect(entry.falseAlarms).toBe(0); // not success/partial_success
      expect(entry.missedFailures).toBe(0); // not failure
      expect(entry.predictiveValue).toBe(0); // 0/4
    });
  });

  // -----------------------------------------------------------------------
  // DecisionArtifact fields
  // -----------------------------------------------------------------------

  describe("DecisionArtifact compatibility", () => {
    it("populates all base artifact fields", () => {
      const report = builder.build([
        obs({ lens: "red_team", verdict: "agree", outcome: "success", concernsRaised: 0 }),
      ]);

      expect(report.id).toMatch(/^lens-calibration-/);
      expect(report.subject).toBe("Lens Calibration Report");
      expect(report.outcome).toBe("computed");
      expect(typeof report.confidence).toBe("number");
      expect(report.reasons.length).toBeGreaterThan(0);
      expect(typeof report.generatedAt).toBe("string");
    });
  });
});
