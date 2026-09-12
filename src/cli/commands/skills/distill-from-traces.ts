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

export async function handleSkillsDistillFromTraces(args: string[]): Promise<void> {
  const parsed = parseKeyValueArgs(args,
    ["candidates", "min-runs", "min-score", "provider", "model"],
    ["json"]);
  const candidatesFile = String(parsed.candidates ?? "");
  if (!candidatesFile) {
    console.error("Usage: alix skills distill-from-traces --candidates <file> [--min-runs 5] [--min-score 0.8] [--provider p] [--model m] [--json]");
    process.exit(1);
  }
  const minRuns = parsed["min-runs"] !== undefined ? Number(parsed["min-runs"]) : undefined;
  const minScore = parsed["min-score"] !== undefined ? Number(parsed["min-score"]) : undefined;

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
  const providerId = String(parsed.provider ?? "") || factoryConf.provider || "ollama";
  const model = String(parsed.model ?? "") || factoryConf.model || "";
  const apiKey = (await getSavedApiKey(providerId)) ?? "";
  const provider = await createProvider({ provider: providerId, model }, apiKey);

  const result = await distillMinedCandidates(candidatesFile, {
    config: factoryConf, provider,
    minRuns: minRuns !== undefined && Number.isFinite(minRuns) ? minRuns : undefined,
    minScore: minScore !== undefined && Number.isFinite(minScore) ? minScore : undefined,
  });

  if (parsed.json === true) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`# distill-from-traces — ${result.distilled.length} distilled, ${result.rejected.length} rejected`);
  for (const name of result.distilled) console.log(`- ${name}`);
  for (const r of result.rejected) console.log(`REJECT ${r.name}: ${r.reason}`);
}
