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

export async function sweepCases(cases, { provider, model }) {
  const results = [];
  for (const caseId of cases) {
    const evalCase = BEHAVIORAL_CASES.find(c => c.id === caseId);
    if (!evalCase) throw new Error(`Unknown eval case: ${caseId}`);
    const startedAt = new Date().toISOString();
    const result = await runEvalCase(evalCase, { driver: evalCase.driver, provider, model });
    const execution = result.execution ?? {};
    const usage = execution.usage ?? null;
    const priced = priceUsage(usage?.records);
    const verified = result.verdict === 'pass'
      && result.objective?.landed === evalCase.expected.objectiveLanded
      && result.status?.honest === true;
    results.push({
      caseId,
      stratum: CASE_STRATUM[caseId] ?? null,
      driver: evalCase.driver,
      provider: execution.provider ?? provider,
      model: usage?.records?.[0]?.model ?? model,
      startedAt,
      verdict: result.verdict,
      verifiedSuccess: verified,
      objectiveLanded: result.objective?.landed ?? null,
      statusHonest: result.status?.honest ?? null,
      objectiveEvidence: result.objective?.evidence ?? null,
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
  const payload = {
    startedAt: results[0]?.startedAt ?? new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    model: selected,
    results,
    verifiedSuccesses: results.filter(r => r.verifiedSuccess).length,
    costUsd: results.every(r => r.completeness === 'complete')
      ? results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0)
      : null,
  };
  const json = JSON.stringify(payload, null, 2) + '\n';
  if (output) writeFileSync(resolve(output), json);
  else process.stdout.write(json);
  if (results.some(r => !r.verifiedSuccess)) process.exitCode = 1;
  return payload;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
