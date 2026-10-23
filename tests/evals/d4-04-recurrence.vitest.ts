import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * d4-04-recurrence.vitest.ts — pins the analysis behind D4-04.
 *
 * D4-04 is the delegate-transport flake observed once during P0-D3:
 * `behavioral.block-replacement` failed on a single `--synthetic` run, then
 * passed 2/2 on immediate re-run and 3/3 without synthetic.
 *
 * This file does NOT claim the flake is gone (a flake that does not reproduce
 * under repetition is not thereby fixed — it is merely unobserved). It pins the
 * two STRUCTURAL facts that bound the investigation, so a future reader does not
 * have to re-derive them:
 *
 *   1. A synthetic fixture cannot reach a delegate case. `runEvalCase` returns
 *      before any driver runs when `syntheticStatus` is set, and the synthetic
 *      fixtures are distinct case objects. So "--synthetic made it flake" is not
 *      a causal mechanism; synthetic mode can only change run ORDER and timing.
 *
 *   2. Every case runs in its own freshly-created temp cwd, and the ownership
 *      registry is rooted at that cwd. A lease from a previous case therefore
 *      cannot block a later one — cross-case lease leakage is excluded.
 *
 * What remains, and is recorded honestly: the delegate path spawns a real child
 * process, so it is exposed to scheduling/load nondeterminism that the
 * in-process scripted main-loop path is not. That is the standing hypothesis,
 * and it is NOT proven here.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const runnerSrc = readFileSync(
  join(repoRoot, "src", "operations", "evals", "evals-runner.ts"),
  "utf-8",
);
const casesSrc = readFileSync(
  join(repoRoot, "src", "operations", "evals", "cases", "index.ts"),
  "utf-8",
);

describe("D4-04 — synthetic fixtures cannot reach a delegate case", () => {
  it("runEvalCase returns before any driver when syntheticStatus is set", () => {
    // The synthetic short-circuit must appear BEFORE the delegate branch in
    // source order. If it ever moved after, a synthetic fixture could run a
    // driver and the historical explanation would become wrong.
    const syntheticIdx = runnerSrc.indexOf("evalCase.syntheticStatus !== undefined");
    const delegateIdx = runnerSrc.indexOf('evalCase.driver === "delegate"');
    expect(syntheticIdx).toBeGreaterThan(-1);
    expect(delegateIdx).toBeGreaterThan(-1);
    expect(syntheticIdx).toBeLessThan(delegateIdx);
  });

  it("the synthetic fixtures are separate cases, not retired behavioural cases", () => {
    // syntheticStatus must only ever be attached to the two evaluator fixtures.
    const occurrences = (casesSrc.match(/syntheticStatus:/g) ?? []).length;
    expect(occurrences).toBe(2);
    // And neither fixture reuses block-replacement's id.
    expect(casesSrc).toContain("behavioral.synthetic-false-success");
    expect(casesSrc).toContain("behavioral.synthetic-false-failure");
  });
});

describe("D4-04 — cross-case lease leakage is excluded by construction", () => {
  it("each case gets a fresh temp cwd", () => {
    // mkdtempSync guarantees a unique directory per case; the ownership registry
    // is rooted at the case cwd, so one case's leases cannot outlive it.
    expect(runnerSrc).toContain("mkdtempSync(join(tmpdir(), \"eval-task-\"))");
  });

  it("the complete fixture root is removed in a finally block", () => {
    // Cleanup is unconditional, so a failed case does not leave a registry
    // behind for a later case to collide with.
    expect(runnerSrc).toMatch(/finally\s*\{\s*rmSync\(fixtureRoot/);
  });
});
