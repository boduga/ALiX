/**
 * P7.5c — Intent → Proposal Mapper sentinels.
 *
 * Enforces governance boundaries:
 *   1. IntentProposalMapper must not import the approval gate.
 *   2. IntentProposalMapper must not import appliers.
 *   3. Proposals are created as "pending", never as "approved".
 *
 * Key invariant: Intent ≠ Proposal. Proposal ≠ Approval. Approval ≠ Apply.
 * Dependency claims use the real import graph (#697); code scans run on
 * comment-stripped source.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { importedSpecifiers, importedBindings, codeOnly } from "../helpers/import-graph.js";

const MAPPER = resolve(__dirname, "../../src/adaptation/intent-proposal-mapper.ts");
const mapperSource = readFileSync(MAPPER, "utf-8");
const mapperCode = codeOnly(mapperSource);

describe("P7.5c — IntentProposalMapper must not import approval gate", () => {
  const FORBIDDEN_MODULES = [
    "approval-gate",
    "agent-card-applier",
    "skill-applier",
    "revert-applier",
  ];

  for (const mod of FORBIDDEN_MODULES) {
    it(`must not import "${mod}"`, () => {
      expect([...importedSpecifiers(MAPPER)].some((s) => s.includes(mod))).toBe(false);
    });
  }

  it("must not import ApprovalGate type or class", () => {
    expect(importedBindings(MAPPER).has("ApprovalGate")).toBe(false);
  });

  it("must not contain approve/reject/apply mutation calls in code", () => {
    expect(mapperCode).not.toMatch(/\.(approve|reject|apply|execute)\(/);
  });
});

describe("P7.5c — Proposal status invariants", () => {
  it("creates proposals with status \"pending\"", () => {
    const statusAssignments = mapperCode.match(/status:\s*"pending"/g);
    expect(statusAssignments).not.toBeNull();
    expect(statusAssignments!.length).toBeGreaterThanOrEqual(1);
  });

  it("must never assign status \"approved\"", () => {
    expect(mapperCode.match(/status:\s*"approved"/g)).toBeNull();
  });

  it("must never assign status \"applied\"", () => {
    expect(mapperCode.match(/status:\s*"applied"/g)).toBeNull();
  });
});

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
