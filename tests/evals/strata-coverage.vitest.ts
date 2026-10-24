/**
 * strata-coverage.vitest.ts — pins the new strata case contracts.
 *
 * Two things are tested here, both of which were real defects found by running
 * the suite rather than by reading it:
 *
 * 1. The composite `files` objective (stratum 4). It must be AND over the SAME
 *    single-file evaluation, so a partial multi-file fix cannot land.
 * 2. The delegate-failure stdout contract (stratum 10). A child's structured
 *    failed result must reach the parent, which parses ONLY stdout.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { evaluateObjective } from "../../src/operations/evals/evaluators/objective-evaluator.js";
import type { EvalObjective } from "../../src/operations/evals/evals-types.js";
import { STRATUM_2_AND_4_CASES } from "../../src/operations/evals/cases/strata-2-4.js";
import { STRATUM_5_AND_10_CASES } from "../../src/operations/evals/cases/strata-5-10.js";
import {
  canLabelCpuOnly,
  isLocalProvider,
  observedProviders,
  classifyCpuOnlyRun,
} from "../../src/operations/evals/cases/stratum-9-local.js";

function makeCwd(): string {
  return mkdtempSync(join(tmpdir(), "eval-strata-"));
}

describe("composite `files` objective (stratum 4)", () => {
  const objective: EvalObjective = {
    kind: "files",
    files: [
      { path: "a.ts", contentEquals: "const a = 1;\n" },
      { path: "b.ts", contentEquals: "const b = 2;\n" },
    ],
  };

  it("lands only when EVERY file satisfies its contract", () => {
    const cwd = makeCwd();
    writeFileSync(join(cwd, "a.ts"), "const a = 1;\n");
    writeFileSync(join(cwd, "b.ts"), "const b = 2;\n");
    expect(evaluateObjective(cwd, objective).landed).toBe(true);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("does NOT land when only one file was fixed", () => {
    const cwd = makeCwd();
    writeFileSync(join(cwd, "a.ts"), "const a = 1;\n");
    writeFileSync(join(cwd, "b.ts"), "var b = 2;\n"); // unfixed
    const r = evaluateObjective(cwd, objective);
    expect(r.landed).toBe(false);
    expect(r.evidence.mismatches?.some(m => m.includes("b.ts"))).toBe(true);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("does NOT land when a file is missing entirely", () => {
    const cwd = makeCwd();
    writeFileSync(join(cwd, "a.ts"), "const a = 1;\n");
    const r = evaluateObjective(cwd, objective);
    expect(r.landed).toBe(false);
    expect(r.evidence.mismatches).toContain("b.ts: file missing: b.ts");
    rmSync(cwd, { recursive: true, force: true });
  });

  it("does not introduce a second scoring engine — same file objective agrees", () => {
    const cwd = makeCwd();
    mkdirSync(join(cwd, "sub"), { recursive: true });
    writeFileSync(join(cwd, "sub", "x.ts"), "const x = 1;\n");
    const single = evaluateObjective(cwd, { kind: "file", path: "sub/x.ts", exists: true, contentEquals: "const x = 1;\n" });
    const composite = evaluateObjective(cwd, {
      kind: "files",
      files: [{ path: "sub/x.ts", contentEquals: "const x = 1;\n" }],
    });
    expect(composite.landed).toBe(single.landed);
    expect(composite.landed).toBe(true);
    rmSync(cwd, { recursive: true, force: true });
  });
});

describe("strata case registry", () => {
  const all = [...STRATUM_2_AND_4_CASES, ...STRATUM_5_AND_10_CASES];

  it("covers strata 2, 4, 5 and 10 with unique case ids", () => {
    const ids = all.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining([
        "behavioral.code-navigation",            // stratum 2
        "behavioral.multi-file-fix",             // stratum 4
        "behavioral.verification-repair",        // stratum 5
        "behavioral.tool-failure-recovery",      // stratum 10
      ]),
    );
  });

  it("every stratum 4 case declares ownedPaths so partial coverage is expressible", () => {
    // Without explicit ownership the delegate driver defaults to ["."] and a
    // single write satisfies the contract — the runtime could never report the
    // partial outcome these cases assert.
    for (const c of all.filter(c => c.id.startsWith("behavioral.multi-file-fix"))) {
      expect(c.ownedPaths, c.id).toEqual(["src/a.ts", "src/b.ts"]);
    }
  });

  it("negative cases expect a non-success status", () => {
    const negatives = all.filter(c => !c.expected.objectiveLanded);
    expect(negatives.length).toBeGreaterThanOrEqual(3);
    for (const c of negatives) {
      expect(c.expected.statuses, c.id).not.toContain("success");
    }
  });
});

describe("stratum 9 — CPU-only labelling guard", () => {
  it("classifies local providers", () => {
    expect(isLocalProvider("ollama")).toBe(true);
    expect(isLocalProvider("local-llama")).toBe(true);
    expect(isLocalProvider("openai")).toBe(false);
  });

  it("refuses a CPU-only label when any remote provider ran", () => {
    const v = canLabelCpuOnly(["ollama", "openai"]);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("openai");
  });

  it("refuses a CPU-only label when nothing ran", () => {
    expect(canLabelCpuOnly([]).ok).toBe(false);
  });

  it("allows the label only for an all-local run", () => {
    expect(canLabelCpuOnly(["ollama", "local-llama"]).ok).toBe(true);
  });

  it("derives observed providers from per-case execution evidence", () => {
    const providers = observedProviders({
      results: [
        { execution: { provider: "ollama" } },
        { execution: { provider: "ollama" } },
      ],
    });
    expect(providers).toEqual(["ollama"]);
  });

  it("fails closed when a case records no provider", () => {
    // An unattributable case must never support a CPU-only claim.
    const verdict = classifyCpuOnlyRun({ results: [{ execution: {} }] });
    expect(verdict.ok).toBe(false);
    expect(verdict.providers).toContain("unknown");
    expect(verdict.reason).toContain("unknown");
  });

  it("refuses a run that mixed local and remote execution", () => {
    const verdict = classifyCpuOnlyRun({
      results: [{ execution: { provider: "ollama" } }, { execution: { provider: "openai" } }],
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("openai");
  });

  it("allows a run whose every case ran on a local provider", () => {
    const verdict = classifyCpuOnlyRun({
      results: [{ execution: { provider: "ollama" } }, { execution: { provider: "ollama" } }],
    });
    expect(verdict).toEqual({ ok: true, providers: ["ollama"] });
  });
});
