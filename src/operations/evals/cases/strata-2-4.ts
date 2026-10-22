import type { EvalCase } from "../evals-types.js";

/**
 * Stratum 2 — unfamiliar-code navigation, and Stratum 4 — multi-file bug fix.
 *
 * DETERMINISTIC cases (scripted provider). They establish case coverage and
 * honest scoring; they do not claim real-model cost qualification and carry no
 * billable usage.
 *
 * Stratum 2 is scored as a READ-ONLY report: the deliverable is an accurate
 * answer, not a file. The objective is therefore `unchanged` on the source tree —
 * a navigation task that mutates nothing is correct, and the evaluator must not
 * equate success with a filesystem change.
 */

/**
 * STRATUM-2A — find and report a value across a small seeded tree.
 *
 * The worker must locate the file exporting the requested constant and report
 * its value, without modifying anything. Success = the tree is untouched AND the
 * runtime reports completion.
 *
 * "Untouched" is source equality on every seeded file, not mere existence: a
 * rewritten neighbour used to pass. The report must name the file AND state the
 * value; the seeded value is distinctive so a wrong answer cannot satisfy it.
 */
export const STRATUM2_NAVIGATION: EvalCase = {
  id: "behavioral.code-navigation",
  description:
    "Read-only navigation: locate a constant in a seeded tree and report it. No mutation expected.",
  driver: "main-loop",
  task:
    "Find which file exports MAX_RETRIES and report its exact value. Do not modify any files.",
  objective: {
    kind: "unchanged",
    path: "src/limits.ts",
    contentEquals: 'export const MAX_RETRIES = "lantern-4";\n',
    unchanged: {
      "src/timeouts.ts": "export const TIMEOUT_MS = 3000;\n",
      "src/index.ts": "export * from './limits.js';\nexport * from './timeouts.js';\n",
    },
    answerIncludes: ["limits.ts", "lantern-4"],
  },
  expected: { objectiveLanded: true, statuses: ["completed"] },
  seed: {
    "src/limits.ts": 'export const MAX_RETRIES = "lantern-4";\n',
    "src/timeouts.ts": "export const TIMEOUT_MS = 3000;\n",
    "src/index.ts": "export * from './limits.js';\nexport * from './timeouts.js';\n",
  },
  scenario: {
    steps: [
      { kind: "text", text: "src/limits.ts exports MAX_RETRIES with value lantern-4." },
      { kind: "text", text: "Done." },
    ],
  },
};

/**
 * STRATUM-4A — multi-file fix: the same bug appears in two files.
 *
 * Both files must be corrected. This is the composite-objective case: a fix that
 * touches only one file has NOT met the objective, so `landed` must be false.
 */
export const STRATUM4_MULTI_FILE_FIX: EvalCase = {
  id: "behavioral.multi-file-fix",
  description:
    "A defect present in two files must be fixed in BOTH. Composite objective; a single-file fix does not land.",
  driver: "delegate",
  task:
    "Both src/a.ts and src/b.ts use the deprecated 'var' keyword. Change both to 'const'.",
  objective: {
    kind: "files",
    files: [
      { path: "src/a.ts", contentEquals: "const value = 1;\n" },
      { path: "src/b.ts", contentEquals: "const other = 2;\n" },
    ],
  },
  expected: { objectiveLanded: true, statuses: ["success"] },
  // Both files are in the objective; declare them as owned so "complete" means
  // both were written, not just any one path under the default ["."] scope.
  ownedPaths: ["src/a.ts", "src/b.ts"],
  seed: {
    "src/a.ts": "var value = 1;\n",
    "src/b.ts": "var other = 2;\n",
  },
  scenario: {
    steps: [
      {
        kind: "tool",
        tool: "patch.apply",
        args: {
          format: "search_replace",
          patchText:
            "<<<<<<< SEARCH path=src/a.ts\nvar value = 1;\n=======\nconst value = 1;\n>>>>>>> REPLACE\n",
        },
      },
      {
        kind: "tool",
        tool: "patch.apply",
        args: {
          format: "search_replace",
          patchText:
            "<<<<<<< SEARCH path=src/b.ts\nvar other = 2;\n=======\nconst other = 2;\n>>>>>>> REPLACE\n",
        },
      },
      { kind: "text", text: "Fixed both files." },
    ],
  },
};

/**
 * STRATUM-4B — the honest negative: only one of the two files is fixed.
 *
 * The composite objective must NOT land, because src/b.ts is untouched. This
 * pins that a partial multi-file fix cannot be scored as success.
 */
export const STRATUM4_PARTIAL_FIX: EvalCase = {
  id: "behavioral.multi-file-fix-partial",
  description:
    "Only one of two defective files is fixed. The composite objective must not land.",
  driver: "delegate",
  task:
    "Both src/a.ts and src/b.ts use the deprecated 'var' keyword. Change both to 'const'.",
  objective: {
    kind: "files",
    files: [
      { path: "src/a.ts", contentEquals: "const value = 1;\n" },
      { path: "src/b.ts", contentEquals: "const other = 2;\n" },
    ],
  },
  expected: { objectiveLanded: false, statuses: ["partial"] },
  seed: {
    "src/a.ts": "var value = 1;\n",
    "src/b.ts": "var other = 2;\n",
  },
  // The objective covers BOTH files, so both must be owned for the runtime to
  // be able to report incomplete coverage. Without this the delegate driver
  // defaults ownedPaths to ["."], a single write then satisfies the ownership
  // contract, and `success` is the *correct* answer under that contract — the
  // case would be asserting a partial outcome the runtime was never given a
  // reason to produce. This mirrors EVAL-007, which expresses partial coverage
  // the same way.
  ownedPaths: ["src/a.ts", "src/b.ts"],
  scenario: {
    steps: [
      {
        kind: "tool",
        tool: "patch.apply",
        args: {
          format: "search_replace",
          patchText:
            "<<<<<<< SEARCH path=src/a.ts\nvar value = 1;\n=======\nconst value = 1;\n>>>>>>> REPLACE\n",
        },
      },
      { kind: "text", text: "Fixed the files." },
    ],
  },
};

export const STRATUM_2_AND_4_CASES: EvalCase[] = [
  STRATUM2_NAVIGATION,
  STRATUM4_MULTI_FILE_FIX,
  STRATUM4_PARTIAL_FIX,
];
