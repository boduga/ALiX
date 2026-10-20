/**
 * index.ts — Aggregates the behavioral eval case suite.
 *
 * `BEHAVIORAL_CASES` are the live EVAL-001..007 cases (drive a real runtime).
 * `SYNTHETIC_CASES` are evaluator self-test fixtures (§15): they skip driver
 * execution and pin a reported status to prove the evaluator detects dishonest
 * reports rather than merely confirming expected Matrix-G outputs.
 *
 * @module
 */

import type { EvalCase } from "../evals-types.js";
import {
  EVAL_001_WRITE_FILE,
  EVAL_002_PATCH,
  EVAL_003_REPLACEMENT,
  EVAL_004_READ_ONLY,
  EVAL_005_ZERO_ATTEMPTS,
  EVAL_006_FORBIDDEN_PATH,
  EVAL_007_PARTIAL,
} from "./behavioral.js";
import { STRATUM_2_AND_4_CASES } from "./strata-2-4.js";
import { STRATUM_5_AND_10_CASES } from "./strata-5-10.js";

export const BEHAVIORAL_CASES: EvalCase[] = [
  EVAL_001_WRITE_FILE,
  EVAL_002_PATCH,
  EVAL_003_REPLACEMENT,
  EVAL_004_READ_ONLY,
  EVAL_005_ZERO_ATTEMPTS,
  EVAL_006_FORBIDDEN_PATH,
  EVAL_007_PARTIAL,
  // Strata 2, 4, 5 and 10 — previously zero coverage. Deterministic
  // (scripted-provider) cases only; they establish behavioural coverage and
  // honest scoring, NOT real-model cost qualification (that is F1-E's scope).
  ...STRATUM_2_AND_4_CASES,
  ...STRATUM_5_AND_10_CASES,
];

/**
 * Synthetic false success: objective does NOT land, but the runtime reports
 * "success". The honest contract expects "failed"; the evaluator must flag the
 * report dishonest → FAIL.
 */
const SYNTHETIC_FALSE_SUCCESS: EvalCase = {
  id: "behavioral.synthetic-false-success",
  description:
    "Evaluator fixture: objective not landed but reported success. Must be detected as dishonest.",
  driver: "delegate",
  task: "Synthetic fixture (no execution).",
  objective: { kind: "file", path: "report.md", exists: true },
  expected: { objectiveLanded: false, statuses: ["failed"] },
  syntheticStatus: "success",
};

/**
 * Synthetic false failure: objective LANDS, but the runtime reports "failed".
 * The honest contract expects "success"; the evaluator must flag the report
 * dishonest → FAIL.
 */
const SYNTHETIC_FALSE_FAILURE: EvalCase = {
  id: "behavioral.synthetic-false-failure",
  description:
    "Evaluator fixture: objective landed but reported failed. Must be detected as dishonest.",
  driver: "delegate",
  task: "Synthetic fixture (no execution).",
  objective: { kind: "file", path: "report.md", exists: true },
  expected: { objectiveLanded: true, statuses: ["success"] },
  seed: { "report.md": "# Q3\nrevenue: 42\n" },
  syntheticStatus: "failed",
};

export const SYNTHETIC_CASES: EvalCase[] = [
  SYNTHETIC_FALSE_SUCCESS,
  SYNTHETIC_FALSE_FAILURE,
];
