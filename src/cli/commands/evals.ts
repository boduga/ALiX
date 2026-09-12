/**
 * evals.ts — CLI commands for the behavioral eval suite.
 *
 *   alix evals run                    Run all suites, both drivers
 *   alix evals run --suite behavioral
 *   alix evals run --driver delegate
 *   alix evals run --driver main-loop
 *   alix evals run --json
 *   alix evals run-dataset --mirror <file> --prompt-name <n> --prompt-text <t>
 *                                     Run a candidate prompt over corpus incidents (P4)
 *
 * @module
 */

import { performance } from "node:perf_hooks";
import type { EvalCase, EvalDriverKind } from "../../evals/evals-types.js";
import { parseKeyValueArgs } from "../helpers/parse-args.js";

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

type ProviderRef = {
  name: string;
  model: string;
};

type EvalsRunDatasetOptions = {
  mirror: string;
  promptName: string;
  promptText: string;
  promptFile: string;
  provider: ProviderRef;
  judgeModel: string;
  scoresOut: string;
  baselineScores: string;
  asJson: boolean;
};

/** Single-quote a value for paste-ready shell commands. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
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
  "run-dataset": handleEvalsRunDataset,
};

/**
 * P4 model-running eval loop: score a candidate prompt over corpus incidents.
 * Reads incident rows (corpus.mjs mirror shape), runs each task through the
 * candidate, LLM-judges the response, and emits score JSONL ready for
 * score.mjs --batch and eval-gate.mjs. Judge defaults to the same provider
 * (self-judge limitation — use a stronger --judge-model when it matters).
 */
export async function handleEvalsRunDataset(args: string[]): Promise<void> {
  const parsed = parseKeyValueArgs(args,
    ["mirror", "prompt-name", "prompt-text", "prompt-file", "provider", "model", "judge-model", "scores-out", "baseline-scores"],
    ["json"]);
  const opts: EvalsRunDatasetOptions = {
    mirror: String(parsed.mirror ?? ""),
    promptName: String(parsed["prompt-name"] ?? ""),
    promptText: String(parsed["prompt-text"] ?? ""),
    promptFile: String(parsed["prompt-file"] ?? ""),
    provider: {
      name: String(parsed.provider ?? ""),
      model: String(parsed.model ?? ""),
    },
    judgeModel: String(parsed["judge-model"] ?? ""),
    scoresOut: String(parsed["scores-out"] ?? ""),
    baselineScores: String(parsed["baseline-scores"] ?? ""),
    asJson: parsed.json === true,
  };
  const { mirror, promptName, provider, judgeModel, scoresOut, baselineScores, asJson } = opts;
  let { promptText } = opts;
  if (!mirror || !promptName || (!promptText && !opts.promptFile)) {
    console.error("Usage: alix evals run-dataset --mirror <file> --prompt-name <n> (--prompt-text <t> | --prompt-file <f>) [--provider p] [--model m] [--judge-model m] [--scores-out f] [--baseline-scores f] [--json]");
    process.exit(1);
  }

  const { loadConfig } = await import("../../config/loader.js");
  const { getSavedApiKey } = await import("../helpers/api-keys.js");
  const { createProvider } = await import("../../providers/registry.js");
  const { runDatasetEval, normalizeIncident, readScoreLedger, gateDatasetEval } = await import("../../evals/dataset-eval.js");
  const { readFile, writeFile } = await import("node:fs/promises");

  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  const factoryConf = config.skills?.factory;
  const providerId = provider.name || factoryConf?.provider || "ollama";
  const model = provider.model || factoryConf?.model || "";
  if (opts.promptFile) promptText = await readFile(opts.promptFile, "utf8");

  let rows: unknown[] = [];
  try {
    const text = await readFile(mirror, "utf8");
    rows = text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  } catch (err) {
    console.error(`Cannot read mirror ${mirror}: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
  const incidents = rows
    .map(normalizeIncident)
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const apiKey = (await getSavedApiKey(providerId)) ?? "";
  const modelProvider = await createProvider({ provider: providerId, model }, apiKey);
  const judge = judgeModel
    ? await createProvider({ provider: providerId, model: judgeModel }, apiKey)
    : undefined;

  const result = await runDatasetEval({
    incidents, promptName, promptText, provider: modelProvider, judgeProvider: judge,
  });

  if (scoresOut) {
    await writeFile(scoresOut, result.scores.map((s) => JSON.stringify(s)).join("\n") + "\n", "utf8");
  }

  // Act wiring (P4): optional baseline gate. On promote, print the exact
  // promotion command (prompt.mjs carries the write); this CLI never writes
  // prompts itself.
  // Nightly pattern (plan Phase 4, same cadence as digest.mjs — the daemon
  // is an on-demand queue, not a scheduler; system cron drives):
  //   30 3 * * * alix evals run-dataset --mirror ~/.alix/corpus/<ds>.jsonl --prompt-name <n> --prompt-file <f> --scores-out ~/.alix/scores/cand.jsonl --baseline-scores ~/.alix/scores/base.jsonl
  let gate: { verdict: string } | null = null;
  if (baselineScores) {
    const base = await readScoreLedger(baselineScores);
    const cand = new Map(result.scores.map((s) => [s.traceId, s.value]));
    gate = gateDatasetEval(base, cand);
  }

  if (asJson) {
    console.log(JSON.stringify({ ...result, scoresOut: scoresOut || undefined, gate }, null, 2));
  } else {
    console.log(`# dataset eval — ${promptName}: ${result.scores.length} scored, ${result.skipped.length} skipped`);
    for (const s of result.scores) console.log(`- ${s.traceId}: ${s.value}`);
    for (const sk of result.skipped) console.log(`SKIP ${sk.traceId}: ${sk.reason}`);
    if (scoresOut) console.log(`Scores written to ${scoresOut}`);
    if (gate) {
      console.log(`verdict: ${gate.verdict}`);
      if (gate.verdict === "promote") {
        // Exact command: the evaluated candidate text, shell-quoted —
        // paste-ready for the operator-gated promotion (plan Phase 4).
        console.log(`promote with: node ~/.alix/skills/langfuse-traces/scripts/prompt.mjs --create --name ${shellQuote(promptName)} --text ${shellQuote(promptText)} --label champion`);
      }
    }
  }
}

export async function handleEvalsCommand(args: string[]): Promise<void> {
  const sub = args[0];
  const handler = HANDLERS[sub];
  if (!handler) {
    console.error("Usage: alix evals <run|run-dataset>");
    console.error("  alix evals run                    Run all eval cases, both drivers");
    console.error("  alix evals run --driver delegate  Run delegate (Matrix-G) cases only");
    console.error("  alix evals run --json             Emit JSON results");
    console.error("  alix evals run-dataset --mirror <file> --prompt-name <n> --prompt-text <t>");
    console.error("                                    Score a candidate prompt over corpus incidents");
    process.exit(1);
  }
  await handler(args.slice(1));
}
