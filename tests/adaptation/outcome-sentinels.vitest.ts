/**
 * P7a — Outcome tracking sentinel tests.
 *
 * Enforces the "Recommend != Decide != Mutate" invariant for the outcome
 * tracking layer. OutcomeStore must be append-only and must not mutate
 * recommendations, governance reviews, or trigger actions.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/** Read a file's source text for structural/grep-based checks. */
function sourceOf(relativePath: string): string {
  const resolved = path.resolve(__dirname, relativePath);
  return fs.readFileSync(resolved, "utf-8");
}

// ---------------------------------------------------------------------------
// Sentinel 1: P7 cannot mutate recommendations
// ---------------------------------------------------------------------------

describe("P7 — no recommendation mutation", () => {
  it("outcome-store.ts does not import ProposalStore", () => {
    const source = sourceOf("../../src/adaptation/outcome-store.ts");
    expect(source).not.toContain("proposal-store");
    expect(source).not.toContain("ProposalStore");
  });
});

// ---------------------------------------------------------------------------
// Sentinel 2: P7 cannot mutate governance reviews
// ---------------------------------------------------------------------------

describe("P7 — no governance review mutation", () => {
  it("outcome-store.ts does not import governance-review", () => {
    const source = sourceOf("../../src/adaptation/outcome-store.ts");
    expect(source).not.toContain("governance-review");
  });
});

// ---------------------------------------------------------------------------
// Sentinel 3: P7 cannot trigger actions
// ---------------------------------------------------------------------------

describe("P7 — no action triggers", () => {
  it("outcome files do not import appliers or approval gate", () => {
    const source1 = sourceOf("../../src/adaptation/outcome-store.ts");
    const source2 = sourceOf("../../src/adaptation/outcome-types.ts");
    const combined = source1 + source2;
    expect(combined).not.toContain("applier");
    expect(combined).not.toContain("ApprovalGate");
    expect(combined).not.toContain("executor");
  });
});

// ---------------------------------------------------------------------------
// Sentinel 4: Outcome records are append-only
// ---------------------------------------------------------------------------

describe("P7 — outcome records are append-only", () => {
  it("outcome-store.ts has no update or delete method", () => {
    const source = sourceOf("../../src/adaptation/outcome-store.ts");
    // Should have append but not update or delete
    expect(source).toContain("async append");
    expect(source).not.toContain("async update");
    expect(source).not.toContain("async delete");
  });

  it("CLI outcome subcommand has no delete", () => {
    const source = sourceOf("../../src/cli/commands/decision.ts");
    // CLI for outcome should not have a delete subcommand
    const outcomeSection = source.match(/case "outcome":[\s\S]*?(?=case |default:)/);
    if (outcomeSection) {
      expect(outcomeSection[0]).not.toContain("delete");
    }
  });
});
