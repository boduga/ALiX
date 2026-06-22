// tests/learning/learning-sentinels.vitest.ts
/**
 * P8.6 — Learning Governance Sentinels
 *
 * Structural enforcement of the core invariant:
 *   Learning proposes. Governance approves.
 *   Learning never mutates directly.
 *
 * These sentinels are grep-based structural tests that run in CI.
 * If any fails, a mutation path was introduced into src/learning/.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { globSync } from "glob";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..");
const SRC_LEARNING = join(ROOT, "src", "learning");

/** All .ts files under src/learning/ (recursive). */
function learningSourceFiles(): string[] {
  if (!existsSync(SRC_LEARNING)) return [];
  return globSync("**/*.ts", { cwd: SRC_LEARNING, absolute: true }).filter(
    (f) => !f.endsWith(".d.ts"),
  );
}

/** Check if any learning file imports from a forbidden path. */
function anyImportsFrom(srcDir: string, forbidden: string[]): string[] {
  const violations: string[] = [];
  for (const file of learningSourceFiles()) {
    const content = readFileSync(file, "utf-8");
    for (const path of forbidden) {
      if (content.includes(`from "${path}`) || content.includes(`from '${path}`)) {
        violations.push(`${file} imports from ${path}`);
      }
    }
  }
  return violations;
}

/** Check if any learning file contains a forbidden pattern. */
function anyMatches(pattern: RegExp): string[] {
  const matches: string[] = [];
  for (const file of learningSourceFiles()) {
    const content = readFileSync(file, "utf-8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        matches.push(`${file}:${i + 1}: ${lines[i].trim()}`);
      }
    }
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Sentinels
// ---------------------------------------------------------------------------

describe("P8.6 — Learning Governance Sentinels", () => {
  // -----------------------------------------------------------------------
  // 1. No mutation imports in src/learning/
  // -----------------------------------------------------------------------

  it("must not import ProposalStore", () => {
    const violations = anyImportsFrom(SRC_LEARNING, [
      "../adaptation/proposal-store.js",
      "../adaptation/proposal-store",
    ]);
    expect(violations).toEqual([]);
  });

  it("must not import ApprovalGate", () => {
    const violations = anyImportsFrom(SRC_LEARNING, [
      "../adaptation/approval-gate.js",
      "../adaptation/approval-gate",
    ]);
    expect(violations).toEqual([]);
  });

  it("must not import any applier module", () => {
    const appliers = [
      "../adaptation/agent-card-applier.js",
      "../adaptation/skill-applier.js",
      "../adaptation/revert-applier.js",
      "agent-card-applier",
      "skill-applier",
      "revert-applier",
    ];
    const violations = anyImportsFrom(SRC_LEARNING, appliers);
    expect(violations).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // 2. No direct calibration file writes
  // -----------------------------------------------------------------------

  it("must not contain writeFileSync or writeFile calls", () => {
    // Allow writeFileSync only in LearningStore (P8.0b), which has its own sentinels.
    // For P8.0a there is no store, so any writeFile is a violation.
    const violations = anyMatches(/(?:writeFileSync|writeFile)\s*\(/);
    expect(violations).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // 3. No approval/apply/reject lifecycle references
  // -----------------------------------------------------------------------

  it("must not reference approve/apply/reject lifecycle functions", () => {
    const violations = anyMatches(
      /\b(?:approve|\.apply|\.reject|approvalGate)\s*\(/,
    );
    expect(violations).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // 4. No auto-generated learning proposals
  // -----------------------------------------------------------------------

  it("must not import AutomaticProposalGenerator", () => {
    const violations = anyImportsFrom(SRC_LEARNING, [
      "../adaptation/automatic-proposal-generator.js",
      "../adaptation/automatic-proposal-generator",
    ]);
    expect(violations).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // 5. CalibrationProfile is a data object (no apply/save methods)
  // -----------------------------------------------------------------------

  it("CalibrationProfile must not have .apply() or .save() methods", () => {
    // Only check the type definition file, not test files
    const typeFile = join(SRC_LEARNING, "learning-types.ts");
    if (!existsSync(typeFile)) return; // not implemented yet
    const content = readFileSync(typeFile, "utf-8");
    // Scanning the CalibrationProfile interface for method declarations
    // This is a structural check: the interface should only have data fields
    const lines = content.split("\n");
    let inCalibrationProfile = false;
    let braceDepth = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes("interface CalibrationProfile")) {
        inCalibrationProfile = true;
        braceDepth = (line.match(/{/g) || []).length;
        continue;
      }
      if (inCalibrationProfile) {
        braceDepth += (line.match(/{/g) || []).length;
        braceDepth -= (line.match(/}/g) || []).length;
        if (braceDepth <= 0) break;
        // Check for function/method signatures
        if (line.includes("(") && line.includes("):") && !line.includes("//")) {
          // Allow standard DecisionArtifact fields + CalibrationProfile fields with getters
          // Flag any function-like signature
          if (
            line.includes("apply(") ||
            line.includes("save(") ||
            line.includes("write(") ||
            line.includes("update(") ||
            line.includes("delete(") ||
            line.includes("clear(")
          ) {
            expect.unreachable(
              `CalibrationProfile has forbidden method at line ${i + 1}: ${line.trim()}`,
            );
          }
        }
      }
    }
  });

  // -----------------------------------------------------------------------
  // 6. No store mutation methods (applies to P8.0b LearningStore when created)
  // -----------------------------------------------------------------------

  it("LearningStore (if implemented) must be append-only", () => {
    const storeFile = join(SRC_LEARNING, "learning-store.ts");
    if (!existsSync(storeFile)) return; // P8.0b — not yet implemented
    const content = readFileSync(storeFile, "utf-8");
    const forbidden = ["delete", "update", "clear", "truncate"];
    for (const method of forbidden) {
      // Look for method definitions on the LearningStore class/interface
      const pattern = new RegExp(`\\b${method}\\s*\\(`, "i");
      if (pattern.test(content)) {
        expect.unreachable(
          `LearningStore has forbidden method: ${method}`,
        );
      }
    }
  });
});
