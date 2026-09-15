/**
 * P7a — Outcome tracking sentinel tests.
 *
 * Enforces the "Recommend != Decide != Mutate" invariant for the outcome
 * tracking layer. OutcomeStore must be append-only and must not mutate
 * recommendations, governance reviews, or trigger actions.
 *
 * Dependency claims use the real import graph (#697); code scans run on
 * comment-stripped source.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { importedSpecifiers, importedBindings, codeOnly } from "../helpers/import-graph.js";

const STORE = resolve(__dirname, "../../src/adaptation/outcome-store.ts");
const TYPES = resolve(__dirname, "../../src/adaptation/outcome-types.ts");
const DECISION_MAIN = resolve(__dirname, "../../src/cli/commands/decision/main.ts");

describe("P7 — no recommendation mutation", () => {
  it("outcome-store.ts does not import ProposalStore", () => {
    const specifiers = [...importedSpecifiers(STORE)];
    expect(specifiers.some((s) => s.includes("proposal-store"))).toBe(false);
    expect(importedBindings(STORE).has("ProposalStore")).toBe(false);
  });
});

describe("P7 — no governance review mutation", () => {
  it("outcome-store.ts does not import governance-review", () => {
    expect([...importedSpecifiers(STORE)].some((s) => s.includes("governance-review"))).toBe(false);
  });
});

describe("P7 — no action triggers", () => {
  it("outcome files do not import appliers or approval gate", () => {
    for (const file of [STORE, TYPES]) {
      const specifiers = [...importedSpecifiers(file)];
      const bindings = importedBindings(file);
      expect(specifiers.some((s) => s.includes("applier")), `applier in ${file}`).toBe(false);
      expect(bindings.has("ApprovalGate"), `ApprovalGate in ${file}`).toBe(false);
      expect(specifiers.some((s) => s.includes("executor")), `executor in ${file}`).toBe(false);
    }
  });
});

describe("P7 — outcome records are append-only", () => {
  it("outcome-store.ts has no update or delete method", () => {
    const code = codeOnly(readFileSync(STORE, "utf-8"));
    expect(code).toContain("async append");
    expect(code).not.toContain("async update");
    expect(code).not.toContain("async delete");
  });

  it("CLI outcome subcommand has no delete", () => {
    // #717 — the decision dispatcher now lives in decision/main.ts.
    const code = codeOnly(readFileSync(DECISION_MAIN, "utf-8"));
    const outcomeSection = code.match(/case "outcome":[\s\S]*?(?=case |default:)/);
    if (outcomeSection) {
      expect(outcomeSection[0]).not.toContain("delete");
    }
  });
});
