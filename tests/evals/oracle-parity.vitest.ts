/**
 * oracle-parity.vitest.ts — the expected-outcome table for the oracle fixes.
 *
 * This is an authorization-shaped change (it changes what counts as a pass), so
 * per the repo rule it needs an expected-outcome table broader than the
 * implementation — not a spot check of the newly-fixed cases.
 *
 * Every row below is a case the oracle previously got WRONG, or a case it must keep
 * getting right. Rows marked "must stay" exist to catch over-correction: a fix that
 * starts failing honest work is as bad as one that passes dishonest work.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { evaluateObjective, answerAsserts } from "../../src/operations/evals/evaluators/objective-evaluator.js";
import { classifyInadmissible } from "../../src/operations/evals/eval-admissibility.js";

const here = dirname(fileURLToPath(import.meta.url));

function cwd(): { dir: string; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "oracle-parity-"));
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("answer assertions — negation parity", () => {
  const NEEDLE = "kestrel-9";
  const rows: Array<[string, "asserted" | "negated" | "absent", string]> = [
    // previously WRONG: this passed
    ["The value is NOT kestrel-9; it is raven-2", "negated", "decoy assertion (the defect)"],
    ["x is kestrel-9? No, x is raven-2", "negated", "correction"],
    ["It was never kestrel-9", "negated", "never"],
    // must stay accepted
    ['The exported constant is `x = "kestrel-9"`.', "asserted", "plain assertion"],
    ["kestrel-9", "asserted", "bare value"],
    ["Value: kestrel-9. Nothing else to report.", "asserted", "assertion with trailing sentence"],
    ["The value is kestrel-9. No files were modified.", "asserted", "a later sentence's `No` is not about the value"],
    ["No files were modified. The value is kestrel-9.", "asserted", "a prior sentence's `No` is not about the value"],
    ["The answer is kestrel-9 regardless of what the comment says", "asserted", "assertion containing a distractor word"],
    // must stay rejected
    ["I could not find the value", "absent", "no answer at all"],
  ];

  for (const [report, want, why] of rows) {
    it(`${want}: ${why}`, () => {
      expect(answerAsserts(report, NEEDLE)).toBe(want);
    });
  }
});

describe("patch / replacement — exact content parity", () => {
  const rows: Array<[string, string, boolean, string]> = [
    // previously WRONG: this passed
    ["const x = 1;\n// export const x = 2;\n", "export const x = 2;", false, "fix present only as a comment"],
    ["block: HELLO", "HELLO", false, "expected text merely embedded"],
    // must stay accepted
    ["export const x = 2;", "export const x = 2;", true, "exact repair"],
    ["HELLO", "HELLO", true, "exact replacement"],
  ];

  for (const [content, expected, want, why] of rows) {
    it(`${want ? "lands" : "rejects"}: ${why}`, () => {
      const { dir, done } = cwd();
      try {
        mkdirSync(join(dir, "src"), { recursive: true });
        writeFileSync(join(dir, "src", "a.ts"), content);
        const r = evaluateObjective(dir, { kind: "patch", path: "src/a.ts", expectedContent: expected }, {});
        expect(r.landed).toBe(want);
        // `changed` must never be a hardcoded claim.
        expect(r.evidence.changed).toBeUndefined();
      } finally {
        done();
      }
    });
  }
});

describe("admissibility — provenance parity", () => {
  const rows: Array<[string, boolean, string]> = [
    // previously WRONG: these were EXCLUDED from both numerator and denominator
    ["Non-retryable write failures: forbidden.md", true, "policy word, not an HTTP 403"],
    ["Command exited with code 1: expected 500, received 3000", true, "task numbers, not a 5xx"],
    ["Command exited with code 1: assertion failed: timeoutMs should be 3000", true, "task mentions a timeout"],
    // previously WRONG: this was SCORED
    ["TLS certificate has expired", false, "genuine transport fault"],
    // must stay excluded
    ["HTTP 403 Forbidden", false, "status position"],
    ["API error 429: rate limit exceeded", false, "rate limit"],
    ["quota exceeded", false, "quota"],
    ["ECONNREFUSED 127.0.0.1:11434", false, "socket"],
    ["request timed out after 300s", false, "provider timeout"],
    // must stay admissible
    ["Unknown tool \"alix_nope\". Available tools: ...", true, "an agent mistake is a finding"],
    ["", true, "no error at all"],
  ];

  for (const [text, admissible, why] of rows) {
    it(`${admissible ? "scored" : "excluded"}: ${why}`, () => {
      expect(classifyInadmissible(text).admissible).toBe(admissible);
    });
  }
});

describe("the fixes do not regress the real collection", () => {
  it("every retained verified run still asserts its answers", () => {
    // Re-scoring the committed evidence against the stricter oracle must not
    // invalidate runs that genuinely passed.
    const dir = join(here, "..", "..", "benchmark", "evidence", "eval-runs", "collection-2026-10-24-final");
    const names = ["read-only.json", "code-navigation.json"];
    let checked = 0;
    for (const name of names) {
      const parsed = JSON.parse(readFileSync(join(dir, name), "utf-8")) as {
        results: Array<{ verifiedSuccess: boolean; evidence?: { finalAnswer?: string } }>;
      };
      for (const row of parsed.results) {
        if (!row.verifiedSuccess) continue;
        checked += 1;
        const answer = row.evidence?.finalAnswer ?? "";
        // read-only / navigation assert a distinctive token from the source.
        const token = name === "read-only.json" ? "kestrel-9" : "lantern-4";
        if (answer.toLowerCase().includes(token)) {
          expect(answerAsserts(answer, token)).toBe("asserted");
        }
      }
    }
    expect(checked).toBe(10);
  });
});
