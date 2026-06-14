/**
 * provider-doctor.ts — CLI commands for provider diagnostics.
 *
 * alix provider doctor              Check all configured providers
 * alix provider doctor google       Check a specific provider
 * alix provider doctor --json       Machine-readable output
 */

import { loadConfig } from "../../config/loader.js";

export async function handleProviderDoctor(args: string[]): Promise<void> {
  const config = await loadConfig(process.cwd());
  const providerFilter = args.find(a => !a.startsWith("--"))?.toLowerCase();
  const jsonMode = args.includes("--json");

  const { PROVIDER_KEY_ENV } = await import("../../providers/unified-complete.js");
  const { checkProvider } = await import("../../providers/provider-doctor.js");

  // Gather configured providers
  const providers: { id: string; model: string }[] = [];
  const mainProvider = config.model.provider;
  const mainModel = config.model.name;
  providers.push({ id: mainProvider, model: mainModel });

  if ((config as any).models) {
    for (const [role, m] of Object.entries((config as any).models)) {
      const mm = m as any;
      if (mm.provider && !providers.find(p => p.id === mm.provider)) {
        providers.push({ id: mm.provider, model: mm.name });
      }
    }
  }

  const results = [];
  for (const p of providers) {
    if (providerFilter && p.id !== providerFilter) continue;
    const envVar = (PROVIDER_KEY_ENV as Record<string, string>)[p.id] || "";
    const apiKey = config.apiKeys?.[p.id] || process.env[envVar] || "";
    const result = await checkProvider(p.id, p.model, apiKey);
    results.push(result);
  }

  if (jsonMode) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  let allOk = true;
  for (const r of results) {
    const icon = r.hasApiKey ? (r.completeOk ? "✅" : "❌") : "⏸";
    const streamIcon = r.streamOk === true ? "✅" : r.streamOk === false ? "❌" : "—";
    console.log(`${icon} ${r.provider}/${r.model}`);
    console.log(`   API key: ${r.hasApiKey ? "✓" : "✗"}`);
    console.log(`   Complete: ${r.completeOk ? "✓" : "✗"}  Stream: ${streamIcon}`);
    if (r.error) console.log(`   Error: ${r.error}`);
    if (!r.completeOk) allOk = false;
    console.log();
  }

  if (!allOk) process.exit(1);
}
