/**
 * Real-provider sweep over selected behavioral eval cases.
 *
 * Runs ONE case at a time on a real provider, captures the runner's own usage
 * record, prices it with the repository pricing catalog, and reports the
 * verifier's verdict. A case is a VERIFIED SUCCESS only when the evaluator's
 * objective actually landed and the reported status was honest.
 *
 * The provider is the operator's current default (`models.default`) unless an
 * explicit `--provider/--model` override is given for a deliberate one-off.
 * No provider or model is hardcoded here.
 */
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runEvalCase } from '../../../dist/src/operations/evals/evals-runner.js';
import { BEHAVIORAL_CASES } from '../../../dist/src/operations/evals/cases/index.js';
import { defaultPricingCatalog } from '../../../dist/src/operations/observability/cost-attribution.js';
import { userConfigDir } from '../../../dist/src/operations/config/loader.js';
import { readFileSync } from 'node:fs';

const CATALOG = defaultPricingCatalog();

/**
 * Eval case → coverage stratum (`baseline-coverage-matrix.mjs` ids).
 *
 * Every behavioral case that can carry cost evidence must be mapped here, or a
 * committed sweep cannot attribute its usage to a PRD stratum and the matrix
 * reports that stratum as unmeasured even though the run happened. Two strata
 * have cases split across BOTH drivers (`main-loop` and `delegate`), so this map
 * is keyed by case id, not by driver.
 *
 * Strata with no behavioral case at all (6 coordination, 8 crash/restart) are
 * measured by their own drivers under `benchmark/evidence/coordination/`.
 */
export const CASE_STRATUM = {
  // 1 — read-only factual inspection
  'behavioral.read-only': 'readonly-inspection',
  // 2 — unfamiliar-code navigation
  'behavioral.code-navigation': 'code-navigation',
  // 3 — single-file edit
  'behavioral.write-file': 'single-file-edit',
  'behavioral.patch-application': 'single-file-edit',
  'behavioral.block-replacement': 'single-file-edit',
  // 4 — multi-file bug fix (composite must land; partial must NOT land)
  'behavioral.multi-file-fix': 'multi-file-fix',
  'behavioral.multi-file-fix-partial': 'multi-file-fix',
  // 5 — verification / repair (applied must land; not-applied must NOT)
  'behavioral.verification-repair': 'verification-repair',
  'behavioral.verification-repair-not-applied': 'verification-repair',
  // 7 — allow/ask/deny capability mixes
  'behavioral.forbidden-path-write': 'capability-mix',
  'behavioral.unmet-write-zero-attempts': 'capability-mix',
  'behavioral.partial-objective': 'capability-mix',
  // 10 — tool failure / malformed tool calls
  'behavioral.tool-failure-recovery': 'tool-failure-recovery',
  'behavioral.malformed-tool-call': 'tool-failure-recovery',
};

export function resolveSweepModel(explicitProvider, explicitModel) {
  if (explicitProvider && explicitModel) return { provider: explicitProvider, name: explicitModel };
  if (explicitProvider || explicitModel) {
    throw new Error('--provider and --model must be given together');
  }
  const configPath = join(userConfigDir(), 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  const d = config?.models?.default;
  if (!d?.provider || !d?.name) {
    throw new Error(`No --provider/--model given and ${configPath} has no models.default`);
  }
  return { provider: d.provider, name: d.name };
}

export function parseSweepArgs(args) {
  const options = { cases: [] };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!['--case', '--provider', '--model', '--output'].includes(flag)) {
      throw new Error(`Unknown argument: ${flag}`);
    }
    const value = args[++index];
    if (!value || value.startsWith('-')) throw new Error(`${flag} requires a value`);
    if (flag === '--case') options.cases.push(value);
    else if (flag === '--provider') options.provider = value;
    else if (flag === '--model') options.model = value;
    else options.output = value;
  }
  if (options.cases.length === 0) throw new Error('--case <caseId> is required');
  return options;
}

/** Price one usage record with the catalog. Unknown pricing stays unknown. */
export function priceUsage(records) {
  let cost = 0;
  let priced = 0;
  for (const record of records ?? []) {
    const entry = CATALOG.lookup(record.provider, record.model);
    if (!entry) continue;
    cost += ((record.inputTokens ?? 0) / 1e6) * entry.inputPerMillion;
    cost += ((record.outputTokens ?? 0) / 1e6) * entry.outputPerMillion;
    priced += 1;
  }
  const total = records?.length ?? 0;
  return {
    costUsd: priced === total && total > 0 ? cost : null,
    completeness: total === 0 ? 'none' : priced === total ? 'complete' : 'partial',
    pricedRecords: priced,
    totalRecords: total,
  };
}

/** Nearest-rank percentile; `null` when no duration was recorded. */
export function percentile(values, p) {
  const sorted = values.filter(v => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

/** Per-run latency summary over case durations, never over the whole suite. */
export function summarizeLatency(results) {
  const durations = results.map(r => r.durationMs).filter(v => typeof v === 'number' && Number.isFinite(v));
  if (durations.length === 0) {
    return { observed: false, samples: 0, p50Ms: null, p95Ms: null, reason: 'no case duration recorded' };
  }
  return {
    observed: true,
    samples: durations.length,
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
  };
}

export async function sweepCases(cases, { provider, model }) {
  const results = [];
  for (const caseId of cases) {
    const evalCase = BEHAVIORAL_CASES.find(c => c.id === caseId);
    if (!evalCase) throw new Error(`Unknown eval case: ${caseId}`);
    const startedAt = new Date().toISOString();
    const result = await runEvalCase(evalCase, { driver: evalCase.driver, provider, model });
    const finishedAt = new Date().toISOString();
    const durationMs = Date.parse(finishedAt) - Date.parse(startedAt);
    const execution = result.execution ?? {};
    const usage = execution.usage ?? null;
    const metrics = execution.metrics ?? null;
    const priced = priceUsage(usage?.records);
    // An inadmissible run never reached a scoreable agent outcome, so it cannot
    // be a verified success and must not be counted as one. It is carried
    // through with its reason so a quota wall cannot masquerade as a refusal.
    const inadmissible = result.verdict === 'inadmissible';
    const verified = !inadmissible
      && result.verdict === 'pass'
      && result.objective?.landed === evalCase.expected.objectiveLanded
      && (!evalCase.guards || result.guards?.satisfied === true)
      && result.status?.honest === true;
    results.push({
      caseId,
      stratum: CASE_STRATUM[caseId] ?? null,
      driver: evalCase.driver,
      provider: execution.provider ?? provider,
      model: usage?.records?.[0]?.model ?? model,
      startedAt,
      finishedAt,
      durationMs,
      // Gate B fields (PRD §7). A count is null when the session log was not
      // observed — never zero. Provider retries are not emitted by the event
      // vocabulary, and operator active review minutes need human observation,
      // so both stay null with their reason rather than being inferred.
      toolCalls: metrics?.toolCalls ?? null,
      toolCallsCompleted: metrics?.toolCallsCompleted ?? null,
      toolCallsFailed: metrics?.toolCallsFailed ?? null,
      rejectedCalls: metrics?.rejectedCalls ?? null,
      repeatedCalls: metrics?.repeatedCalls ?? null,
      toolRetries: metrics?.toolRetries ?? null,
      providerRetries: null,
      driverReinvocations: null,
      operatorInterventions: metrics?.operatorInterventions ?? null,
      operatorCancellations: metrics?.operatorCancellations ?? null,
      operatorActiveReviewMinutes: null,
      unobserved: [
        ...(metrics?.unobserved ?? ['no session log was observed; counts are unknown']),
        // A driver re-invocation is a sweep-level re-run of a case, not per-case
        // session evidence, so it cannot be derived from this log.
        'driver re-invocations are not recorded per case',
        'operator active review minutes require human observation',
      ],
      verdict: result.verdict,
      inadmissible,
      inadmissibleReason: result.status?.inadmissibleReason ?? null,
      verifiedSuccess: verified,
      objectiveLanded: result.objective?.landed ?? null,
      statusHonest: result.status?.honest ?? null,
      // Record what the model ACTUALLY reported against what the case expected.
      // Without this a failed case is opaque: "objectiveLanded=false,
      // statusHonest=false" cannot distinguish "the guard held and the model
      // honestly reported failure" (good) from "the model claimed success it did
      // not achieve" (bad). Both produce identical booleans.
      statusActual: result.status?.actual ?? null,
      statusExpected: result.status?.expected ?? evalCase.expected.statuses,
      objectiveExpected: evalCase.expected.objectiveLanded,
      objectiveEvidence: result.objective?.evidence ?? null,
      guardEvidence: result.guards ?? null,
      runId: execution.runId ?? null,
      sessionId: execution.sessionId ?? null,
      usage: usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, observed: usage.observed } : null,
      ...priced,
    });
  }
  return results;
}

export async function main(args = process.argv.slice(2)) {
  const { output, ...options } = parseSweepArgs(args);
  const selected = resolveSweepModel(options.provider, options.model);
  const results = await sweepCases(options.cases, { provider: selected.provider, model: selected.name });
  const startedAt = results[0]?.startedAt ?? new Date().toISOString();
  const finishedAt = new Date().toISOString();
  const payload = {
    startedAt,
    finishedAt,
    // Whole-suite wall time. Per-case p50/p95 live in `latency`; keeping the
    // suite total separate prevents two slow cases from being read as
    // suite-wide latency.
    suiteDurationMs: Date.parse(finishedAt) - Date.parse(startedAt),
    model: selected,
    results,
    latency: summarizeLatency(results),
    verifiedSuccesses: results.filter(r => r.verifiedSuccess).length,
    // Excluded from both success and failure: a provider fault is not a result.
    inadmissible: results.filter(r => r.inadmissible).length,
    costUsd: results.every(r => r.completeness === 'complete')
      ? results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0)
      : null,
  };
  const json = JSON.stringify(payload, null, 2) + '\n';
  if (output) writeFileSync(resolve(output), json);
  else process.stdout.write(json);
  // Non-zero when any case is unverified or inadmissible. A quota wall must make
  // the command fail, not look like a clean refusal.
  if (results.some(r => !r.verifiedSuccess)) process.exitCode = 1;
  return payload;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
