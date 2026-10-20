import type { EvalCase } from "../evals-types.js";

/**
 * Stratum 5 — verification / repair, and Stratum 10 — tool failure and
 * malformed tool calls.
 *
 * These are DETERMINISTIC cases driven by the scripted provider. They establish
 * case coverage and honest scoring for the two strata that had none. They do NOT
 * claim real-model cost qualification — that is F1-E's separate scope, and these
 * cases carry no billable usage.
 *
 * Contract notes (same rules as behavioral.ts):
 * - Model-facing tool names only (`file.create`, `patch.apply`, `file.delete`);
 *   never internal executor IDs.
 * - `expected.statuses` states what the runtime is honestly allowed to report,
 *   independent of whether the objective landed.
 * - A case may legitimately be `objectiveLanded: false` yet PASS, when the
 *   objective's absence is the specified contract.
 */

const SEARCH_REPLACE = (path: string, search: string, replace: string) =>
  `<<<<<<< SEARCH path=${path}\n${search}\n=======\n${replace}\n>>>>>>> REPLACE\n`;

/**
 * STRATUM-5A — detect and repair a broken source file.
 *
 * The worker reads a file with a wrong value, then patches it to the expected
 * value. This is the "verification then repair" shape: the deliverable is the
 * corrected content, and a repair that does not land is a failure.
 */
export const STRATUM5_REPAIR: EvalCase = {
  id: "behavioral.verification-repair",
  description:
    "Worker repairs an incorrect value in an existing file via patch.apply. The corrected content is the deliverable.",
  driver: "delegate",
  task: "Read src/config.ts and fix the timeout value to 3000.",
  objective: {
    kind: "replacement",
    path: "src/config.ts",
    expectedContent: "export const timeoutMs = 3000;",
  },
  expected: { objectiveLanded: true, statuses: ["success"] },
  seed: { "src/config.ts": "export const timeoutMs = 500;\n" },
  ownedPaths: ["src/config.ts"],
  scenario: {
    steps: [
      {
        kind: "tool",
        tool: "patch.apply",
        args: {
          format: "search_replace",
          patchText: SEARCH_REPLACE(
            "src/config.ts",
            "export const timeoutMs = 500;",
            "export const timeoutMs = 3000;",
          ),
        },
      },
      { kind: "text", text: "Fixed the timeout value." },
    ],
  },
};

/**
 * STRATUM-5B — the honest negative: a "repair" that changes nothing.
 *
 * The worker claims it fixed the file but the objective's expected content never
 * appears. The objective must not land, and the runtime must not report success.
 * This is the case that prevents "verification" from being scored as success just
 * because the worker said so.
 */
export const STRATUM5_REPAIR_NOT_APPLIED: EvalCase = {
  id: "behavioral.verification-repair-not-applied",
  description:
    "Worker claims a repair but never applies it. Objective must not land and success must not be reported.",
  driver: "delegate",
  task: "Read src/config.ts and fix the timeout value to 3000.",
  objective: {
    kind: "replacement",
    path: "src/config.ts",
    expectedContent: "export const timeoutMs = 3000;",
  },
  expected: { objectiveLanded: false, statuses: ["failed"] },
  seed: { "src/config.ts": "export const timeoutMs = 500;\n" },
  // Owned but never written: Matrix-G's zero-progress ruling makes `failed` the
  // honest status, so this negative stays honest without the path default.
  ownedPaths: ["src/config.ts"],
  scenario: {
    steps: [
      { kind: "text", text: "The timeout is already correct." },
      { kind: "text", text: "Done." },
    ],
  },
};

/**
 * STRATUM-10A — tool failure, then recovery.
 *
 * The first tool call fails (the provider raises), and the worker recovers by
 * issuing a valid call on the next step. The deliverable lands, so this is a
 * success — the point is that a transient tool failure does not poison the task.
 *
 * `file.delete` of a non-existent path is used as the failing call: it exercises
 * the error path without touching the objective's file.
 */
export const STRATUM10_TOOL_FAILURE_RECOVERY: EvalCase = {
  id: "behavioral.tool-failure-recovery",
  description:
    "A tool call fails, then the worker recovers with a valid call. The objective still lands honestly.",
  driver: "delegate",
  task: "Create recover.md containing: RECOVERED",
  objective: {
    kind: "file",
    path: "recover.md",
    exists: true,
    contentEquals: "RECOVERED",
  },
  expected: { objectiveLanded: true, statuses: ["success"] },
  ownedPaths: ["recover.md"],
  scenario: {
    steps: [
      // Fails: nothing to delete. Exercises the tool-error path.
      { kind: "tool", tool: "file.delete", args: { path: "does-not-exist.md" } },
      // Recovers with the real deliverable.
      { kind: "tool", tool: "file.create", args: { path: "recover.md", content: "RECOVERED" } },
      { kind: "text", text: "Recovered and wrote the file." },
    ],
  },
};

/**
 * STRATUM-10B — malformed tool call, no recovery.
 *
 * The provider raises immediately, so no tool ever executes and nothing lands.
 * The honest outcome is failure; the case pins that a hard model/tool error is
 * never scored as success.
 */
export const STRATUM10_MALFORMED_NO_RECOVERY: EvalCase = {
  id: "behavioral.malformed-tool-call",
  description:
    "Provider raises on the first step so no tool executes. Nothing lands and failure is reported.",
  driver: "delegate",
  task: "Create malformed.md containing: SHOULD_NOT_EXIST",
  objective: {
    kind: "file",
    path: "malformed.md",
    exists: true,
    contentIncludes: ["SHOULD_NOT_EXIST"],
  },
  expected: { objectiveLanded: false, statuses: ["failed"] },
  scenario: {
    steps: [
      { kind: "error", error: "malformed tool call: missing required argument 'path'" },
    ],
  },
};

export const STRATUM_5_AND_10_CASES: EvalCase[] = [
  STRATUM5_REPAIR,
  STRATUM5_REPAIR_NOT_APPLIED,
  STRATUM10_TOOL_FAILURE_RECOVERY,
  STRATUM10_MALFORMED_NO_RECOVERY,
];
