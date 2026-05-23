import { loadConfig } from "/home/babasola/Dev/Monolith/.worktrees/context-evaluation/src/config/loader.js";
import { createProvider } from "/home/babasola/Dev/Monolith/.worktrees/context-evaluation/src/providers/registry.js";

async function main() {
  const cwd = process.cwd();
  console.log("Loading config...");
  const config = await loadConfig(cwd);

  console.log("\n=== Model Tiers ===");
  const tiers = ["thinking", "coding", "fast", "critic", "tiny", "image"];

  for (const tier of tiers) {
    const tierConfig = config.subagents?.[tier];
    if (!tierConfig) {
      console.log(`\n[${tier.toUpperCase()}] Not configured`);
      continue;
    }
    console.log(`\n[${tier.toUpperCase()}]`);
    console.log(`  Provider: ${tierConfig.provider}`);
    console.log(`  Model: ${tierConfig.name}`);
  }

  console.log("\n=== Testing Each Tier ===\n");

  for (const tier of tiers) {
    const tierConfig = config.subagents?.[tier];
    if (!tierConfig) continue;

    console.log(`Testing ${tier} tier (${tierConfig.provider}/${tierConfig.name})...`);

    try {
      const provider = createProvider({ provider: tierConfig.provider, model: tierConfig.name });
      const result = await provider.complete({
        messages: [{ role: "user", content: "Say 'hello' in exactly one word" }],
      });
      console.log(`  ✓ Response: ${result.text.substring(0, 50)}`);
    } catch (err) {
      console.log(`  ✗ Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log("\nDone!");
}

main().catch(console.error);