/**
 * evals.ts — CLI commands for the behavioral eval suite.
 *
 *   alix evals run                    Run all suites, both drivers
 *   alix evals run --suite behavioral
 *   alix evals run --driver delegate
 *   alix evals run --driver main-loop
 *   alix evals run --json
 *
 * @module
 */

import { performance } from "node:perf_hooks";
import type { EvalCase, EvalDriverKind } from "../../evals/evals-types.js";

const VALID_SUITES = ["behavioral"] as const;
const VALID_DRIVERS = ["delegate", "main-loop", "both"] as const;

function printHuman(run: {
  results: Array<{
    caseId: string;
    objective: { landed: boolean };
    status: { actual?: string; expected: string[]; honest: boolean };
    verdict: string;
  }>;
  summary: { total: number; passed: number; failed: number };
}): void {
  const banner = Array.from({ length: 34 }, () => "─").join("");
  console.log("Behavioral Eval Suite");
  console.log(banner);
  console.log();
  for (const r of run.results) {
    const tag = r.verdict === "pass" ? "PASS" : "FAIL";
    const objective = r.objective.landed ? "LANDED" : "NOT LANDED";
    const honest = r.status.honest ? "yes" : "no";
    console.log(`${tag}  ${r.caseId}`);
    console.log(`      objective: ${objective}`);
    console.log(`      status:    ${r.status.actual ?? "(none)"}  expected: ${r.status.expected.join("|")}`);
    console.log(`      honest:    ${honest}`);
    console.log();
  }
  console.log(banner);
  console.log(`${run.summary.total} cases`);
  console.log(`${run.summary.passed} passed`);
  console.log(`${run.summary.failed} failed`);
}

function printJson(run: unknown): void {
  console.log(JSON.stringify(run, null, 2));
}

export async function handleEvalsRun(args: string[]): Promise<void> {
  const { loadConfig } = await import("../../config/loader.js");
  const { runEvalSuite, saveRun } = await import("../../evals/evals-runner.js");
  const { BEHAVIORAL_CASES, SYNTHETIC_CASES } = await import("../../evals/cases/index.js");

  let suite: string | undefined;
  let driver: EvalDriverKind | "both" = "both";
  let asJson = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--suite" && args[i + 1]) suite = args[++i];
    else if (args[i] === "--driver" && args[i + 1]) {
      const d = args[++i] as EvalDriverKind | "both";
      if (!(VALID_DRIVERS as readonly string[]).includes(d)) {
        console.error(`Unknown driver "${d}". Valid drivers: ${VALID_DRIVERS.join(", ")}`);
        process.exit(1);
      }
      driver = d;
    } else if (args[i] === "--json") asJson = true;
  }
  if (suite !== undefined && !(VALID_SUITES as readonly string[]).includes(suite)) {
    console.error(`Unknown suite "${suite}". Valid suites: ${VALID_SUITES.join(", ")}`);
    process.exit(1);
  }

  const cases: EvalCase[] = [...BEHAVIORAL_CASES];
  if (args.includes("--synthetic")) cases.push(...SYNTHETIC_CASES);

  const cwd = process.cwd();
  await loadConfig(cwd);

  const start = performance.now();
  const run = await runEvalSuite(cases, { suite: "behavioral", driver });
  const file = saveRun(cwd, run);

  if (asJson) {
    printJson({ ...run, summary: { ...run.summary, durationMs: run.summary.durationMs } });
  } else {
    printHuman(run);
    console.log(`Results saved to ${file}`);
  }
}

const HANDLERS: Record<string, (args: string[]) => Promise<void>> = {
  run: handleEvalsRun,
};

export async function handleEvalsCommand(args: string[]): Promise<void> {
  const sub = args[0];
  const handler = HANDLERS[sub];
  if (!handler) {
    console.error("Usage: alix evals <run>");
    console.error("  alix evals run                    Run all eval cases, both drivers");
    console.error("  alix evals run --driver delegate  Run delegate (Matrix-G) cases only");
    console.error("  alix evals run --json             Emit JSON results");
    process.exit(1);
  }
  await handler(args.slice(1));
}
