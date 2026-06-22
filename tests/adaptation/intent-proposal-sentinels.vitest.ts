/**
 * P7.5c — Intent → Proposal Mapper sentinels.
 *
 * Enforces governance boundaries at source-code level:
 *   1. IntentProposalMapper must not import the approval gate.
 *   2. IntentProposalMapper must not import appliers.
 *   3. Proposals are created as "pending", never as "approved".
 *
 * Key invariant: Intent ≠ Proposal. Proposal ≠ Approval. Approval ≠ Apply.
 * The mapper creates a proposal but must never approve or apply it.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sourceOf(relativePath: string): string {
  return readFileSync(resolve(__dirname, relativePath), "utf-8");
}

// ---------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------

const mapperSource = sourceOf("../../src/adaptation/intent-proposal-mapper.ts");

// ---------------------------------------------------------------------------
// Sentinel 1: No approval gate
// ---------------------------------------------------------------------------

describe("P7.5c — IntentProposalMapper must not import approval gate", () => {
  const FORBIDDEN_MODULES = [
    "approval-gate",
    "agent-card-applier",
    "skill-applier",
    "revert-applier",
  ];

  for (const mod of FORBIDDEN_MODULES) {
    it(`must not import "${mod}"`, () => {
      expect(mapperSource).not.toContain(mod);
    });
  }

  it("must not import ApprovalGate type or class", () => {
    expect(mapperSource).not.toContain("ApprovalGate");
  });

  it("must not contain approve/reject/apply mutation calls in code", () => {
    // Strip comments to check code-only
    const codeOnly = mapperSource
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(codeOnly).not.toMatch(/\.(approve|reject|apply|execute)\(/);
  });
});

// ---------------------------------------------------------------------------
// Sentinel 2: Proposal created as "pending", not "approved"
// ---------------------------------------------------------------------------

describe("P7.5c — Proposal status invariants", () => {
  it("creates proposals with status \"pending\"", () => {
    // The only status string literal assignment should be "pending"
    const statusAssignments = mapperSource.match(/status:\s*"pending"/g);
    expect(statusAssignments).not.toBeNull();
    expect(statusAssignments!.length).toBeGreaterThanOrEqual(1);
  });

  it("must never assign status \"approved\"", () => {
    // Strip comments to focus on code
    const codeOnly = mapperSource
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const approvedAssignments = codeOnly.match(/status:\s*"approved"/g);
    expect(approvedAssignments).toBeNull();
  });

  it("must never assign status \"applied\"", () => {
    const codeOnly = mapperSource
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const appliedAssignments = codeOnly.match(/status:\s*"applied"/g);
    expect(appliedAssignments).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Sentinel 3: Boundary comment exists
// ---------------------------------------------------------------------------

describe("P7.5c — Boundary documentation", () => {
  it("contains the key boundary comment in source", () => {
    expect(mapperSource).toContain("Intent ≠ Proposal");
    expect(mapperSource).toContain("Proposal ≠ Approval");
    expect(mapperSource).toContain("Approval ≠ Apply");
  });

  it("documents that it does NOT approve or apply", () => {
    expect(mapperSource).toContain("does NOT approve or apply");
  });
});
