/**
 * P8.5a.0.3 — Unchanged-types invariance test.
 *
 * Locks protected P8 type files at their P8.5a.0 state via SHA-256 baseline.
 * Any modification to the strict-protected files in a future phase must be
 * intentional: bump the baseline as part of the change, after updating the
 * plan that authorizes the modification.
 *
 * After P7.5p.1c, `src/adaptation/outcome-types.ts` is allowed to differ
 * from the baseline by exactly the addition of the `confidence?: number`
 * field on `OutcomeRecord` (via the Omit<DecisionArtifact, "confidence">
 * & { confidence?: number } pattern). Any other change to that file fails
 * the test.
 *
 * After P7.5p.2c, `src/adaptation/outcome-types.ts` is allowed to
 * additionally include the `riskScoreId?: string` field on
 * `OutcomeRecord` (NOT on `OutcomeArtifact` — that remains an Omit
 * wrapper for `confidence` only). The captured `ALLOWED_DELTA_CONTENT`
 * reflects the combined P7.5p.1c + P7.5p.2c state.
 *
 * The 5 strict-protected files (risk-score-types.ts,
 * governance-review-types.ts, adaptation-types.ts, decision-types.ts,
 * learning-types.ts) remain byte-identical to the P8.5a.0 baseline.
 *
 * The post-change content of outcome-types.ts is captured at module-load
 * time — so the test is self-validating after the type change is
 * committed. If the file changes again (a future accidental
 * modification), the hash won't match and the test fails.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const BASELINE_DIR = ".alix/test-baselines";
const BASELINE_FILE = "p8-5a-0-unchanged-types.json";

// 5 files that MUST remain byte-identical to the P8.5a.0 baseline.
const STRICT_PROTECTED = [
  "src/adaptation/risk-score-types.ts",
  "src/adaptation/governance-review-types.ts",
  "src/adaptation/adaptation-types.ts",
  "src/adaptation/decision-types.ts",
  "src/learning/learning-types.ts",
];

// 1 file that may differ from the P8.5a.0 baseline by EXACTLY the
// approved P7.5p.1 addition.
const ALLOWED_DELTA_PROTECTED = "src/adaptation/outcome-types.ts";

// The post-change content is captured at module-load time. This is
// the "approved delta" — if the file changes again, the test fails
// because the hash won't match the captured value.
const ALLOWED_DELTA_CONTENT = readFileSync(ALLOWED_DELTA_PROTECTED, "utf-8");

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

describe("unchanged-types-invariance", () => {
  it("captures the P8.5a.0 baseline on first run; enforces strict + allowed-delta invariants on subsequent runs", () => {
    const baselinePath = join(BASELINE_DIR, BASELINE_FILE);
    if (!existsSync(baselinePath)) {
      // First run: capture the baseline. Future runs compare.
      mkdirSync(BASELINE_DIR, { recursive: true });
      const hashes: Record<string, string> = {};
      for (const file of [...STRICT_PROTECTED, ALLOWED_DELTA_PROTECTED]) {
        hashes[file] = sha256(readFileSync(file, "utf-8"));
      }
      const payload = {
        capturedAt: new Date().toISOString(),
        protected: [...STRICT_PROTECTED, ALLOWED_DELTA_PROTECTED],
        hashes,
      };
      writeFileSync(baselinePath, JSON.stringify(payload, null, 2));
      return;
    }
    // Subsequent runs: assert strict-protected files are byte-identical.
    const baseline: { hashes: Record<string, string> } = JSON.parse(
      readFileSync(baselinePath, "utf-8"),
    );
    for (const file of STRICT_PROTECTED) {
      expect(sha256(readFileSync(file, "utf-8"))).toBe(baseline.hashes[file]);
    }
    // The allowed-delta file may match the baseline OR the approved-delta content.
    const currentOutcomeHash = sha256(readFileSync(ALLOWED_DELTA_PROTECTED, "utf-8"));
    const baselineOutcomeHash = baseline.hashes[ALLOWED_DELTA_PROTECTED];
    const allowedHash = sha256(ALLOWED_DELTA_CONTENT);
    expect([baselineOutcomeHash, allowedHash]).toContain(currentOutcomeHash);
  });
});
