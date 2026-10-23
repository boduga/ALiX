import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BEHAVIORAL_CASES } from "../../src/operations/evals/cases/index.js";
import { evaluateObjective } from "../../src/operations/evals/evaluators/objective-evaluator.js";

// Drive the actual registered objectives with correct repairs and decoys. A
// comment containing the desired code must not turn an unfixed source into a
// landed repair. These fixtures deliberately do not derive expected bytes from
// the case oracle, so weakening that oracle makes the regression fail.
const repairs = [
  { id: "behavioral.patch-application", path: "src/util.ts", fixed: "export const x = 2;\n", broken: "export const x = 1;\n// export const x = 2;\n" },
  { id: "behavioral.block-replacement", path: "src/util.ts", fixed: 'const greeting = "hi";\n', broken: 'const greeting = "hello";\n// const greeting = "hi";\n' },
  { id: "behavioral.verification-repair", path: "src/config.ts", fixed: "export const timeoutMs = 3000;\n", broken: "export const timeoutMs = 500;\n// export const timeoutMs = 3000;\n" },
];

describe("registered repair oracles", () => {
  it.each(repairs)("$id accepts the repair and rejects a comment-only decoy", ({ id, path, fixed, broken }) => {
    const evalCase = BEHAVIORAL_CASES.find(c => c.id === id)!;
    const cwd = mkdtempSync(join(tmpdir(), "eval-corpus-oracle-"));
    try {
      mkdirSync(dirname(join(cwd, path)), { recursive: true });
      writeFileSync(join(cwd, path), fixed);
      expect(evaluateObjective(cwd, evalCase.objective).landed).toBe(true);
      writeFileSync(join(cwd, path), broken);
      expect(evaluateObjective(cwd, evalCase.objective).landed).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
