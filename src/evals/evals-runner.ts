/**
 * evals-runner.ts — Orchestrates a full behavioral eval run.
 *
 * Pipeline (per §17):
 *
 *   EvalCase → Driver → EvalExecutionResult → ObjectiveEvaluator + StatusEvaluator → EvalResult → EvalRun
 *
 * Each case executes in its own isolated temporary cwd (recorded only in the
 * in-memory result, never persisted with filesystem paths), with test
 * configuration installed and any seed files laid down before the driver runs.
 * Cleanup always happens in a finally block so a failed case never contaminates
 * the next one.
 *
 * @module
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import type { AlixConfig } from "../config/schema.js";
import { loadConfig } from "../config/loader.js";
import { runTask } from "../run.js";
import { evaluateObjective } from "./evaluators/objective-evaluator.js";
import { evaluateStatus } from "./evaluators/status-evaluator.js";
import { createSubagentExecutor, runDelegateCase } from "./drivers/delegate-driver.js";
import { runMainLoopCase } from "./drivers/main-loop-driver.js";
import {
  setScriptedScenario,
  clearScriptedScenario,
} from "./providers/scripted-mock-carrier.js";
import type {
  EvalCase,
  EvalDriverKind,
  EvalExecutionResult,
  EvalResult,
  EvalRun,
  EvalSuite,
} from "./evals-types.js";

/** Install a minimal scripted-mock test configuration in an eval cwd. */
export function installEvalConfig(cwd: string, provider = "scripted-mock"): void {
  mkdirSync(join(cwd, ".alix"), { recursive: true });
  writeFileSync(
    join(cwd, ".alix", "config.json"),
    JSON.stringify(
      {
        models: { default: { provider, name: "mock" } },
        permissions: {
          default: "allow",
          tools: {},
          protectedPaths: [],
          allowNetworkDomains: [],
          denyCommands: [],
        },
        context: {
          repoMap: false,
          repoMapMode: "lite",
          maxRepoMapTokens: 1000,
          semanticSearch: false,
          includeGitStatus: false,
          pinnedFiles: [],
        },
        runtime: {
          provider: "process",
          shell: "/bin/sh",
          commandTimeoutMs: 30000,
          envAllowlist: [],
        },
        ui: { enabled: false, host: "localhost", port: 3000, transport: "sse" },
        mcpServers: [],
      },
      null,
      2,
    ),
  );
}

/** Lay down seed files (path scoped to `cwd`, creating parents). */
export function installSeed(cwd: string, seed?: Record<string, string>): void {
  if (!seed) return;
  for (const [relPath, content] of Object.entries(seed)) {
    const full = join(cwd, relPath);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
}

function evalCaseCwd(): string {
  return mkdtempSync(join(tmpdir(), "eval-task-"));
}

/** Run a single case in an isolated cwd and produce its EvalResult. */
export async function runEvalCase(
  evalCase: EvalCase,
  opts: { driver?: EvalDriverKind } = {},
): Promise<EvalResult> {
  const cwd = evalCaseCwd();
  try {
    installEvalConfig(cwd);
    installSeed(cwd, evalCase.seed);

    let execution: EvalExecutionResult;
    if (evalCase.syntheticStatus !== undefined) {
      // Evaluator self-test fixture: no runtime execution; the reported status
      // is fixed so we can prove the evaluator flags dishonest reports.
      execution = {
        driver: evalCase.driver,
        cwd,
        status: evalCase.syntheticStatus,
        summary: `synthetic fixture reporting "${evalCase.syntheticStatus}"`,
      };
    } else if (evalCase.driver === "delegate") {
      const config: AlixConfig = await loadConfig(cwd);
      const executor = createSubagentExecutor(config, { sessionId: `eval-${evalCase.id}` });
      execution = await runDelegateCase(evalCase, cwd, executor);
    } else {
      // Main-loop: the registry provider reads the scenario from the in-process
      // carrier, so set it before the loop and clear it afterwards.
      if (evalCase.scenario) setScriptedScenario(evalCase.scenario);
      try {
        execution = await runMainLoopCase(evalCase, cwd, (c, t, o) => runTask(c, t, o));
      } finally {
        clearScriptedScenario();
      }
    }

    const objective = evaluateObjective(cwd, evalCase.objective);
    const objectiveCorrect = objective.landed === evalCase.expected.objectiveLanded;
    const status = evaluateStatus(
      objectiveCorrect,
      execution.status ?? execution.reason,
      evalCase.expected.statuses,
    );
    const honest = objectiveCorrect && status.honest;
    const verdict = objectiveCorrect && honest ? "pass" : "fail";

    return { caseId: evalCase.id, objective, status, verdict, execution };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

const CASE_BY_DRIVER: Record<EvalDriverKind | "both", (c: EvalCase) => boolean> = {
  delegate: (c) => c.driver === "delegate",
  "main-loop": (c) => c.driver === "main-loop",
  both: () => true,
};

/** Run a suite of cases and aggregate into a persisted EvalRun. */
export async function runEvalSuite(
  cases: EvalCase[],
  opts: {
    suite?: EvalSuite;
    driver?: EvalDriverKind | "both";
  } = {},
): Promise<EvalRun> {
  const driver = opts.driver ?? "both";
  const suite = opts.suite ?? "behavioral";
  const filter = CASE_BY_DRIVER[driver];
  const selected = cases.filter(filter);

  const startedAt = new Date().toISOString();
  const started = Date.now();
  const results: EvalResult[] = [];
  for (const evalCase of selected) {
    try {
      results.push(await runEvalCase(evalCase, { driver: evalCase.driver }));
    } catch (err) {
      // A case that throws yields an explicit failed result rather than aborting
      // the whole run.
      results.push({
        caseId: evalCase.id,
        objective: { landed: false, evidence: {} },
        status: { actual: undefined, expected: evalCase.expected.statuses, honest: false },
        verdict: "fail",
        execution: { driver: evalCase.driver, cwd: "<isolated>", error: String(err) },
      });
    }
  }

  const durationMs = Date.now() - started;
  return {
    runId: randomUUID(),
    startedAt,
    finishedAt: new Date().toISOString(),
    suite,
    driver,
    results,
    summary: {
      total: results.length,
      passed: results.filter((r) => r.verdict === "pass").length,
      failed: results.filter((r) => r.verdict === "fail").length,
      objectiveLanded: results.filter((r) => r.objective.landed).length,
      honest: results.filter((r) => r.status.honest).length,
      durationMs,
    },
  };
}

/** Persist a run to `<targetDir>/.alix/evals/<runId>.json`. */
export function saveRun(targetDir: string, run: EvalRun): string {
  const dir = join(targetDir, ".alix", "evals");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${run.runId}.json`);
  writeFileSync(file, JSON.stringify(run, null, 2));
  return file;
}

/** Load previously persisted eval runs for a project directory. */
export function loadPreviousRuns(targetDir: string): EvalRun[] {
  const dir = join(targetDir, ".alix", "evals");
  const runs: EvalRun[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return runs;
  }
  for (const entry of entries) {
    try {
      runs.push(JSON.parse(readFileSync(join(dir, entry), "utf8")) as EvalRun);
    } catch {
      // skip malformed run files
    }
  }
  return runs;
}
