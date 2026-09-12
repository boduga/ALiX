/**
 * distill-from-traces.ts — `alix skills distill-from-traces` (P3 loop closure).
 *
 * Mine emits candidates (mine.mjs --factory-out); this command distills
 * each one through runSkillFactoryFromTrace with the configured factory
 * provider. Operator/nightly context — never the hot loop. Per-candidate
 * outcomes reported; a single bad row never aborts the batch.
 *
 * Chain: mine.mjs --scores ledger.jsonl --factory-out c.json
 *   → alix skills distill-from-traces --candidates c.json
 */

import { parseKeyValueArgs } from "../../helpers/parse-args.js";

export type DistillOptions = {
  candidatesFile: string;
  minRuns?: number;
  minScore?: number;
  provider?: string;
  model?: string;
  asJson: boolean;
};

/** Pure arg parsing (throws usage error); the handler maps it to exit 1. */
export function parseDistillArgs(args: string[]): DistillOptions {
  const parsed = parseKeyValueArgs(args,
    ["candidates", "min-runs", "min-score", "provider", "model"],
    ["json"]);
  const candidatesFile = String(parsed.candidates ?? "");
  if (!candidatesFile) {
    throw new Error("Usage: alix skills distill-from-traces --candidates <file> [--min-runs 5] [--min-score 0.8] [--provider p] [--model m] [--json]");
  }
  const toFiniteNumber = (value: unknown): number | undefined => {
    if (value === undefined) return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    candidatesFile,
    minRuns: toFiniteNumber(parsed["min-runs"]),
    minScore: toFiniteNumber(parsed["min-score"]),
    provider: parsed.provider !== undefined ? String(parsed.provider) : undefined,
    model: parsed.model !== undefined ? String(parsed.model) : undefined,
    asJson: parsed.json === true,
  };
}

export async function handleSkillsDistillFromTraces(args: string[]): Promise<void> {
  let opts: DistillOptions;
  try {
    opts = parseDistillArgs(args);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
  const { loadConfig } = await import("../../../config/loader.js");
  const { getSavedApiKey } = await import("../../helpers/api-keys.js");
  const { createProvider } = await import("../../../providers/registry.js");
  const { distillMinedCandidates } = await import("../../../skills/factory.js");

  const config = await loadConfig(process.cwd());
  const factoryConf = config.skills?.factory;
  if (!factoryConf || !factoryConf.enabled) {
    console.error("Skill factory is not enabled (skills.factory in config). Nothing distilled.");
    process.exit(1);
  }
  const providerId = opts.provider ?? factoryConf.provider ?? "ollama";
  const model = opts.model ?? factoryConf.model ?? "";
  const apiKey = (await getSavedApiKey(providerId)) ?? "";
  const provider = await createProvider({ provider: providerId, model }, apiKey);

  const result = await distillMinedCandidates(opts.candidatesFile, {
    config: factoryConf, provider,
    minRuns: opts.minRuns,
    minScore: opts.minScore,
  });

  if (opts.asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`# distill-from-traces — ${result.distilled.length} distilled, ${result.rejected.length} rejected`);
  for (const name of result.distilled) console.log(`- ${name}`);
  for (const r of result.rejected) console.log(`REJECT ${r.name}: ${r.reason}`);
}
