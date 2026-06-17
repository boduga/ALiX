/**
 * observability-export.ts -- P4.2g Full Report Export CLI.
 *
 * Usage: alix observability export [--session <id>] [--format json|table]
 *
 * Reads model.usage events and produces a cost attribution report
 * using the versioned PricingCatalog.
 */

import { CostAttribution } from "../../observability/cost-attribution.js";

export async function cmdExport(cwd: string, args: string[]): Promise<void> {
  const sessionIdx = args.indexOf("--session");
  const sessionId = sessionIdx >= 0 ? args[sessionIdx + 1] : undefined;
  const format = args.includes("--format") && args[args.indexOf("--format") + 1] === "json" ? "json" : "table";

  const attribution = new CostAttribution(cwd);
  const summary = await attribution.summary(sessionId);

  if (format === "json") {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  // Table format
  console.log("Cost Attribution Report");
  if (sessionId) console.log(`Session: ${sessionId}`);
  console.log(`Period: ${summary.periodStart || "N/A"} -- ${summary.periodEnd}`);
  console.log(`Total tokens: ${summary.totalTokens.toLocaleString()}`);
  console.log(`Total cost: $${summary.totalCost.toFixed(6)}`);
  console.log();

  if (Object.keys(summary.byProvider).length === 0) {
    console.log("No model usage events found.");
    return;
  }

  console.log("By Provider:");
  for (const [provider, detail] of Object.entries(summary.byProvider)) {
    const costStr = detail.cost < 0 ? "cost unknown" : `$${detail.cost.toFixed(6)}`;
    console.log(`  ${provider}:`);
    console.log(`    tokens:     ${detail.tokens.toLocaleString()}`);
    console.log(`    cost:       ${costStr}`);
    console.log(`    calls:      ${detail.calls}`);
    console.log(`    latency:    ${detail.latencyMs}ms`);
    console.log(`    input:      ${detail.inputTokens.toLocaleString()}`);
    console.log(`    output:     ${detail.outputTokens.toLocaleString()}`);
    console.log(`    cached:     ${detail.cachedInputTokens.toLocaleString()}`);
    console.log(`    reasoning:  ${detail.reasoningTokens.toLocaleString()}`);
  }

  if (Object.keys(summary.byWorkflow).length > 0) {
    console.log("\nBy Workflow / Run:");
    for (const [wf, detail] of Object.entries(summary.byWorkflow)) {
      const costStr = detail.cost < 0 ? "cost unknown" : `$${detail.cost.toFixed(6)}`;
      console.log(`  ${wf}: tokens=${detail.tokens} calls=${detail.calls} cost=${costStr}`);
    }
  }

  if (summary.unknownPricingModels.length > 0) {
    console.log("\nModels without pricing (cost unknown):");
    for (const m of summary.unknownPricingModels) {
      console.log(`  ${m}`);
    }
  }
}
