/**
 * P8.5a.0.3 — Unchanged-types invariance test.
 *
 * Locks the six protected P8 type files at their P8.5a.0 state via
 * SHA-256 baseline. Any modification to these files in a future phase
 * must be intentional: bump the baseline as part of the change, after
 * updating the plan that authorizes the modification.
 *
 * The protected files are the artifact-type definitions that the
 * Evidence Chain layer reads. The chain layer's whole point is to
 * derive provenance without rewriting these types — so we want a
 * tripwire if they shift unexpectedly.
 *
 * This test is self-bootstrapping: on the first run it captures the
 * baseline; on subsequent runs it compares against it.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const PROTECTED = [
  "src/adaptation/outcome-types.ts",
  "src/adaptation/risk-score-types.ts",
  "src/adaptation/governance-review-types.ts",
  "src/adaptation/adaptation-types.ts",
  "src/adaptation/decision-types.ts",
  "src/learning/learning-types.ts",
];

const BASELINE_DIR = ".alix/test-baselines";
const BASELINE_FILE = "p8-5a-0-unchanged-types.json";

interface Baseline {
  capturedAt: string;
  protected: string[];
  hashes: Record<string, string>;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function readOrCreateBaseline(baselinePath: string): Baseline | "missing" {
  if (!existsSync(baselinePath)) return "missing";
  const raw = readFileSync(baselinePath, "utf-8");
  return JSON.parse(raw) as Baseline;
}

function captureBaseline(): Baseline {
  const hashes: Record<string, string> = {};
  for (const file of PROTECTED) {
    hashes[file] = sha256(readFileSync(file, "utf-8"));
  }
  return {
    capturedAt: new Date().toISOString(),
    protected: PROTECTED,
    hashes,
  };
}

describe("unchanged-types-invariance", () => {
  it("the six protected type files remain byte-identical to the P8.5a.0 baseline", () => {
    const baselinePath = join(BASELINE_DIR, BASELINE_FILE);
    const existing = readOrCreateBaseline(baselinePath);

    if (existing === "missing") {
      // First run: capture the baseline and pass permissively.
      if (!existsSync(BASELINE_DIR)) {
        mkdirSync(BASELINE_DIR, { recursive: true });
      }
      const fresh = captureBaseline();
      writeFileSync(baselinePath, JSON.stringify(fresh, null, 2) + "\n", "utf-8");
      // Sanity: every protected file was hashed.
      expect(Object.keys(fresh.hashes).sort()).toEqual([...PROTECTED].sort());
      return;
    }

    // Subsequent runs: re-hash and compare.
    const current = captureBaseline();

    // The set of protected files must match the baseline (catches
    // accidental additions or removals to the protected list).
    expect(Object.keys(current.hashes).sort()).toEqual(
      Object.keys(existing.hashes).sort(),
    );

    for (const file of PROTECTED) {
      const expected = existing.hashes[file];
      const actual = current.hashes[file];
      expect(
        actual,
        `${file} hash drift — baseline=${expected} current=${actual}`,
      ).toBe(expected);
    }
  });
});
