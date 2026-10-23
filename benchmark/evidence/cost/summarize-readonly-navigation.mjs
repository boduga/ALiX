#!/usr/bin/env node
/**
 * Offline arithmetic replay of recorded readonly/navigation results.
 * The rate is an explicit historical metadata input from the old summary.
 * This circular metadata dependency cannot independently prove invocation-time
 * pricing, an invoice, oracle correctness, or the original run's provenance.
 * No model calls, configuration loading, or credentials are involved.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Replay recorded costs; unsuccessful attempts remain in the numerator. */
export function summarizeReadonlyNavigation(raw, rate) {
  const round = value => {
    if (!Number.isFinite(value * 1e6)) throw new Error('Cost exceeds finite rounding range');
    return Math.round(value * 1e6) / 1e6;
  };
  if (!rate || !Number.isFinite(rate.inputPerMillion) || rate.inputPerMillion < 0
    || !Number.isFinite(rate.outputPerMillion) || rate.outputPerMillion < 0
    || typeof rate.effectiveFrom !== 'string' || !Number.isFinite(Date.parse(rate.effectiveFrom))) {
    throw new Error('An explicit finite historical rate and effectiveFrom are required');
  }
  if (!raw?.model?.provider || !raw.model.name || !Array.isArray(raw.results) || raw.results.length !== 2) {
    throw new Error('Expected model identity and exactly two unambiguous case rows');
  }
  const expected = new Map([
    ['behavioral.read-only', 'readonly-inspection'],
    ['behavioral.code-navigation', 'code-navigation'],
  ]);
  const seenRuns = new Set();
  const perStratum = {};
  let total = 0;
  let successes = 0;
  for (const row of raw.results) {
    if (!row || !expected.has(row.caseId) || expected.get(row.caseId) !== row.stratum || Object.hasOwn(perStratum, row.stratum)
      || typeof row.runId !== 'string' || !row.runId || seenRuns.has(row.runId)
      || row.provider !== raw.model.provider || row.model !== raw.model.name || row.driver !== 'main-loop') {
      throw new Error('Ambiguous case, stratum, run, driver, or model identity');
    }
    seenRuns.add(row.runId);
    if (row.completeness !== 'complete' || row.usage?.observed !== true
      || !Number.isInteger(row.totalRecords) || row.totalRecords <= 0 || row.pricedRecords !== row.totalRecords
      || !Number.isInteger(row.usage.inputTokens) || row.usage.inputTokens < 0
      || !Number.isInteger(row.usage.outputTokens) || row.usage.outputTokens < 0) {
      throw new Error('Complete observed usage and pricing counts are required');
    }
    if (!['pass', 'fail'].includes(row.verdict)
      || [row.verifiedSuccess, row.objectiveLanded, row.statusHonest].some(value => typeof value !== 'boolean')) {
      throw new Error('Explicit verdict, objective, honesty, and success flags are required');
    }
    const verified = row.verdict === 'pass' && row.objectiveLanded && row.statusHonest;
    if (row.verifiedSuccess !== verified) throw new Error('Inconsistent verified-success claim');
    const cost = (row.usage.inputTokens * rate.inputPerMillion + row.usage.outputTokens * rate.outputPerMillion) / 1e6;
    if (!Number.isFinite(cost) || !Number.isFinite(row.costUsd) || row.costUsd < 0
      || Math.abs(row.costUsd - cost) > 1e-9) throw new Error('Recorded cost does not match explicit rate');
    total += cost;
    successes += Number(verified);
    perStratum[row.stratum] = {
      caseId: row.caseId, runId: row.runId,
      inputTokens: row.usage.inputTokens, outputTokens: row.usage.outputTokens,
      costUsd: round(cost), completeness: 'complete', verifiedSuccesses: Number(verified),
      verdict: row.verdict, objectiveLanded: row.objectiveLanded, statusHonest: row.statusHonest,
    };
  }
  return {
    qualification: 'recorded arithmetic replay only; no independent invocation or oracle proof',
    provider: raw.model.provider, model: raw.model.name,
    rate: { inputPerMillion: rate.inputPerMillion, outputPerMillion: rate.outputPerMillion, effectiveFrom: rate.effectiveFrom },
    completeness: 'complete', verifiedSuccesses: successes, costUsd: round(total),
    costPerVerifiedSuccessUsd: successes ? round(total / successes) : null, perStratum,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const here = dirname(fileURLToPath(import.meta.url));
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--output' || !args[1] || args[1].startsWith('-'))) {
    throw new Error('Usage: node summarize-readonly-navigation.mjs [--output <path>]');
  }
  const raw = JSON.parse(readFileSync(resolve(here, 'readonly-navigation-gpt4o.json'), 'utf8'));
  const metadata = JSON.parse(readFileSync(resolve(here, 'readonly-navigation.json'), 'utf8'));
  const output = JSON.stringify(summarizeReadonlyNavigation(raw, metadata.rate), null, 2) + '\n';
  if (args.length) {
    // Exclusive creation prevents accidental destruction of existing paid evidence.
    writeFileSync(resolve(args[1]), output, { flag: 'wx' });
  } else process.stdout.write(output);
}
