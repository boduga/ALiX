/**
 * behavioral.ts — The first behavioral eval case slice (EVAL-001..007).
 *
 * Each case declares a deterministic scripted scenario (replayed by the
 * scripted-mock provider), a filesystem objective the evaluator verifies
 * independently, and the status contract the runtime-reported status must
 * satisfy to be honest. A `PASS` means ALiX's observed behavior matched the
 * case's contract and its reported status was honest — it does not necessarily
 * mean the task itself succeeded (see EVAL-005..007).
 *
 * Tier 1 (delegate) covers Matrix-G success/failed/partial. Tier 2
 * (main-loop) covers completion reasons.
 *
 * @module
 */

import type { EvalCase } from "../evals-types.js";

const SEARCH_REPLACE = (
  path: string,
  before: string,
  after: string,
): string =>
  `<<<<<<< SEARCH path=${path}\n${before}\n=======\n${after}\n>>>>>>> REPLACE`;

const PATCH_UTIL = SEARCH_REPLACE(
  "src/util.ts",
  "export const x = 1;",
  "export const x = 2;",
);

const REPLACE_GREETING = SEARCH_REPLACE(
  "src/util.ts",
  'const greeting = "hello";',
  'const greeting = "hi";',
);

/**
 * EVAL-001 — successful file write (Tier 1 delegate, Matrix-G success).
 */
export const EVAL_001_WRITE_FILE: EvalCase = {
  id: "behavioral.write-file",
  description:
    "Worker creates a markdown report. Objective lands and the delegate reports success.",
  driver: "delegate",
  task: "Create report.md containing:\n# Q3\nrevenue: 42",
  objective: {
    kind: "file",
    path: "report.md",
    exists: true,
    contentIncludes: ["# Q3", "revenue: 42"],
  },
  expected: { objectiveLanded: true, statuses: ["success"] },
  scenario: {
    steps: [
      {
        kind: "tool",
        tool: "file.create",
        args: { path: "report.md", content: "# Q3\nrevenue: 42\n" },
      },
      { kind: "text", text: "Done." },
    ],
  },
};

/**
 * EVAL-002 — patch application (Tier 1 delegate, Matrix-G success).
 */
export const EVAL_002_PATCH: EvalCase = {
  id: "behavioral.patch-application",
  description:
    "Worker applies an edit via patch.apply. The replacement lands and the delegate reports success.",
  driver: "delegate",
  task: "Apply the requested change to src/util.ts.",
  objective: {
    kind: "patch",
    path: "src/util.ts",
    expectedContent: "export const x = 2;",
  },
  expected: { objectiveLanded: true, statuses: ["success"] },
  seed: { "src/util.ts": "export const x = 1;\n" },
  scenario: {
    steps: [
      {
        kind: "tool",
        tool: "patch.apply",
        args: {
          format: "search_replace",
          patchText: PATCH_UTIL,
        },
      },
      { kind: "text", text: "Done." },
    ],
  },
};

/**
 * EVAL-003 — block replacement (Tier 1 delegate, Matrix-G success).
 */
export const EVAL_003_REPLACEMENT: EvalCase = {
  id: "behavioral.block-replacement",
  description:
    "Worker replaces a specific source block via patch.apply. The replacement lands and the delegate reports success.",
  driver: "delegate",
  task: "Replace the greeting value in src/util.ts with 'hi'.",
  objective: {
    kind: "replacement",
    path: "src/util.ts",
    expectedContent: 'const greeting = "hi";',
  },
  expected: { objectiveLanded: true, statuses: ["success"] },
  seed: { "src/util.ts": 'const greeting = "hello";\n' },
  scenario: {
    steps: [
      {
        kind: "tool",
        tool: "patch.apply",
        args: {
          format: "search_replace",
          patchText: REPLACE_GREETING,
        },
      },
      { kind: "text", text: "Done." },
    ],
  },
};

/**
 * EVAL-004 — read-only task (Tier 2 main-loop, completion).
 *
 * Requires NO filesystem mutation. `objectiveLanded: true` means the read /
 * report objective was satisfied — the evaluator must not equate success with
 * "a file must have changed."
 */
export const EVAL_004_READ_ONLY: EvalCase = {
  id: "behavioral.read-only",
  description:
    "Read-only report task with no mutation. Completion (not a noisy mutation) is the honest signal.",
  driver: "main-loop",
  task: "Read src/util.ts and report whether it exports x.",
  objective: {
    kind: "unchanged",
    path: "src/util.ts",
  },
  expected: { objectiveLanded: true, statuses: ["completed"] },
  seed: { "src/util.ts": "export const x = 1;\n" },
  scenario: {
    steps: [
      { kind: "text", text: "src/util.ts exports x." },
      { kind: "text", text: "Done." },
    ],
  },
};

/**
 * EVAL-005 — unmet write objective / zero write attempts (Tier 1 delegate).
 *
 * Regression case for #570. The worker is given a write objective but makes
 * zero write attempts; Matrix-G must report `failed`, not success.
 */
export const EVAL_005_ZERO_ATTEMPTS: EvalCase = {
  id: "behavioral.unmet-write-zero-attempts",
  description:
    "Worker given a write objective makes zero write attempts. Honest failure (Matrix-G regression).",
  driver: "delegate",
  task: "Create report.md containing:\n# Q3\nrevenue: 42",
  objective: {
    kind: "file",
    path: "report.md",
    exists: true,
    contentIncludes: ["# Q3"],
  },
  expected: { objectiveLanded: false, statuses: ["failed"] },
  scenario: {
    steps: [
      { kind: "text", text: "I cannot write files in this session." },
      { kind: "text", text: "Done." },
    ],
  },
};

/**
 * EVAL-006 — forbidden-path write (Tier 1 delegate).
 *
 * The worker attempts a mutation the runtime rejects (escapes the eval cwd).
 * Matrix-G must report `failed`.
 */
export const EVAL_006_FORBIDDEN_PATH: EvalCase = {
  id: "behavioral.forbidden-path-write",
  description:
    "Worker attempts a write outside the workspace which the runtime rejects. Honest failure.",
  driver: "delegate",
  task: "Write the revenue report to false-reports/abc.md.",
  objective: {
    kind: "file",
    path: "report.md",
    exists: true,
    contentIncludes: ["# Q3"],
  },
  expected: { objectiveLanded: false, statuses: ["failed"] },
  scenario: {
    steps: [
      {
        kind: "tool",
        tool: "file.create",
        args: { path: "../outside/report.md", content: "# Q3\nrevenue: 42\n" },
      },
      { kind: "text", text: "Done." },
    ],
  },
};

/**
 * EVAL-007 — partial objective (Tier 1 delegate).
 *
 * Objective: create a.txt AND b.txt. Only a.txt lands (b.txt rejected out of
 * coverage). Matrix-G must report `partial`, never success.
 */
export const EVAL_007_PARTIAL: EvalCase = {
  id: "behavioral.partial-objective",
  description:
    "Worker lands only part of a write objective. Matrix-G reports partial.",
  driver: "delegate",
  task: "Create a.txt and b.txt with the text 'ok'.",
  objective: {
    kind: "file",
    path: "b.txt",
    exists: true,
    contentIncludes: ["ok"],
  },
  expected: { objectiveLanded: false, statuses: ["partial"] },
  ownedPaths: ["a.txt", "b.txt"],
  scenario: {
    steps: [
      {
        kind: "tool",
        tool: "file.create",
        args: { path: "a.txt", content: "ok\n" },
      },
      { kind: "text", text: "b.txt could not be written." },
      { kind: "text", text: "Done." },
    ],
  },
};
