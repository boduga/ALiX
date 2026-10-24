/**
 * Scripted-contract cases must never be scored on a real provider.
 *
 * These five cases test RUNTIME CONTRACTS (forbidden-path refusal, partial
 * completion, malformed-tool-call handling). Their `expected.objectiveLanded` is
 * `false` because the scripted scenario is authored to fail. A real model simply
 * does the task, so it is scored `false` — not from misbehaving, but from not
 * replaying the script.
 *
 * Measured 2026-10-22: five unmarked cases ran on real gpt-4o across three
 * sweeps, consumed $0.524213 of $0.994258 (52.7%) and could not produce a single
 * verified success. The marker exists so that cannot recur silently.
 */
import { describe, it, expect } from "vitest";
import { BEHAVIORAL_CASES } from "../../src/operations/evals/cases/index.js";
import { runEvalCase } from "../../src/operations/evals/evals-runner.js";

/** The five cases whose expectation belongs to the scripted provider. */
const SCRIPTED_CONTRACT_IDS = [
  "behavioral.unmet-write-zero-attempts",
  "behavioral.partial-objective",
  "behavioral.multi-file-fix-partial",
  "behavioral.verification-repair-not-applied",
  "behavioral.malformed-tool-call",
];

describe("scriptedExpectationOnly", () => {
  it("marks exactly the cases whose expectation is scripted-specific", () => {
    const marked = BEHAVIORAL_CASES.filter((c) => c.scriptedExpectationOnly).map((c) => c.id).sort();
    expect(marked).toEqual([...SCRIPTED_CONTRACT_IDS].sort());
  });

  it("never marks a case whose expectation a real model can satisfy", () => {
    for (const c of BEHAVIORAL_CASES) {
      if (c.scriptedExpectationOnly) {
        // The marker is only meaningful for an expectation of absence.
        expect(c.expected.objectiveLanded).toBe(false);
      }
    }
  });

  it("keeps the forbidden-path deny test valid for real models", () => {
    // This one is NOT scripted-specific: a real model can and must satisfy it,
    // so marking it would silently drop a security case from real evidence.
    const deny = BEHAVIORAL_CASES.find((c) => c.id === "behavioral.forbidden-path-write");
    expect(deny).toBeDefined();
    expect(deny!.scriptedExpectationOnly).toBeFalsy();
  });

  it("refuses to score a marked case on a real provider instead of spending tokens", async () => {
    const marked = BEHAVIORAL_CASES.find((c) => c.scriptedExpectationOnly)!;
    await expect(
      runEvalCase(marked, { driver: marked.driver, provider: "openai", model: "gpt-4o" }),
    ).rejects.toThrow(/scriptedExpectationOnly|scripted-contract case/);
  });
});
