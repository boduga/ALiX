/**
 * validate-model-routing.ts — Run model routing validation for M0.9.
 *
 * Usage: npx tsx scripts/validate-model-routing.ts
 *
 * Tests each model tier (fast, thinking, coding) against curated prompts
 * and reports classification accuracy.
 */

import { VALIDATION_CASES, VALIDATION_THRESHOLDS } from "./validation-cases.js";
import type { ModelRoutingResult } from "../src/kernel/model-routing-validation.js";
import { summarizeRoutingResults } from "../src/kernel/model-routing-validation.js";

interface TierTest {
  name: string;
  model: string;
  provider: string;
}

const TIERS: TierTest[] = [
  { name: "fast", model: "qwen3:4b", provider: "ollama" },
  { name: "thinking", model: "qwen3:8b", provider: "ollama" },
  { name: "coding", model: "qwen2.5-coder:7b", provider: "ollama" },
];

async function classifyWithModel(tier: TierTest, prompt: string): Promise<ModelRoutingResult["rawOutput"]> {
  // Use Ollama API directly
  const response = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: tier.model,
      prompt: `Classify this task. Return ONLY valid JSON with no explanation.
{
  "domain": "coding|research|infra|docs|business|personal|unsafe",
  "intent": "short description",
  "risk": "low|medium|high|critical"
}

Task: ${prompt}`,
      stream: false,
      format: "json",
    }),
  });
  const data = await response.json() as any;
  return data.response ?? "";
}

function parseResult(raw: string): Partial<ModelRoutingResult> {
  try {
    const parsed = JSON.parse(raw);
    return {
      validJson: true,
      domainCorrect: false, // set by caller
      intentCorrect: false,
      riskCorrect: false,
    };
  } catch {
    return { validJson: false, domainCorrect: false, intentCorrect: false, riskCorrect: false };
  }
}

async function runTier(tier: TierTest): Promise<ModelRoutingResult[]> {
  const results: ModelRoutingResult[] = [];
  console.log(`\nTesting ${tier.name} tier (${tier.model})...`);

  for (const c of VALIDATION_CASES) {
    process.stdout.write(`  ${c.id}... `);
    const raw = await classifyWithModel(tier, c.prompt);
    const parsed = parseResult(raw);

    let domainCorrect = false;
    let intentCorrect = false;
    let riskCorrect = false;

    if (parsed.validJson) {
      try {
        const json = JSON.parse(raw);
        domainCorrect = json.domain === c.expectedDomain;
        intentCorrect = (json.intent || "").toLowerCase().includes(c.expectedIntent.toLowerCase());
        riskCorrect = json.risk === c.expectedRisk;
      } catch {}
    }

    results.push({
      caseId: c.id,
      model: tier.model,
      validJson: parsed.validJson ?? false,
      domainCorrect,
      intentCorrect,
      riskCorrect,
      rawOutput: raw.slice(0, 200),
    });

    process.stdout.write(domainCorrect && intentCorrect && riskCorrect ? "✓\n" : "✗\n");
  }

  return results;
}

async function main() {
  console.log("M0.9 Model Routing Validation");
  console.log("============================\n");
  console.log(`Cases: ${VALIDATION_CASES.length}`);

  for (const tier of TIERS) {
    const results = await runTier(tier);
    const summary = summarizeRoutingResults(results);
    console.log(`\n--- ${tier.name} Results ---`);
    console.log(`  Valid JSON:    ${(summary.validJsonRate * 100).toFixed(0)}% (threshold: ${(VALIDATION_THRESHOLDS[tier.name as keyof typeof VALIDATION_THRESHOLDS].minValidJson * 100).toFixed(0)}%)`);
    console.log(`  Domain Acc:    ${(summary.domainAccuracy * 100).toFixed(0)}% (threshold: ${(VALIDATION_THRESHOLDS[tier.name as keyof typeof VALIDATION_THRESHOLDS].minDomainAccuracy * 100).toFixed(0)}%)`);
    console.log(`  Intent Acc:    ${(summary.intentAccuracy * 100).toFixed(0)}% (threshold: ${(VALIDATION_THRESHOLDS[tier.name as keyof typeof VALIDATION_THRESHOLDS].minIntentAccuracy * 100).toFixed(0)}%)`);
    console.log(`  Pass: ${summary.passedFastTierThreshold ? "✓" : "✗"}`);
  }
}

main().catch(console.error);
