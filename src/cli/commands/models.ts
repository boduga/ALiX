/**
 * models.ts — CLI commands for model profile management.
 * Thin wrappers; all logic lives in src/models/*.ts and src/config/*.ts.
 */

import { isModelTier, MODEL_SUBAGENT_TIERS } from "../../config/schema.js";
import type { ModelTier } from "../../config/schema.js";
import type { ModelInfo } from "../../providers/catalog.js";

export async function handleModelsDoctor(args: string[]): Promise<void> {
  const { detectSystem } = await import("../../config/hardware-detect.js");
  const { loadConfig } = await import("../../config/loader.js");
  const { runDoctor } = await import("../../models/model-doctor.js");
  const { listProfiles } = await import("../../config/profile-registry.js");
  const config = await loadConfig(process.cwd(), { requireModel: false });
  const system = detectSystem(config as any);
  const report = runDoctor(system, config as any, listProfiles(), config.modelProfile);
  if (args.includes("--json")) { console.log(JSON.stringify(report, null, 2)); return; }
  console.log("\nALiX Model Doctor\n");
  for (const sec of report.sections) {
    console.log(sec.title);
    for (const i of sec.items) console.log(`  ${i}`);
    console.log();
  }
  console.log("Profile Compatibility");
  for (const pc of report.profileCompatibility) {
    console.log(`  ${pc.status === "compatible" ? "✅" : pc.status === "partial" ? "⚠️" : "❌"} ${pc.id.padEnd(20)} ${pc.status}${pc.reason ? `: ${pc.reason}` : ""}`);
  }
  if (report.issues.length > 0) {
    console.log("\nIssues");
    for (const issue of report.issues) console.log(`  ${issue.severity === "error" ? "❌" : issue.severity === "warning" ? "⚠️" : "ℹ️"} ${issue.message}`);
  }
  if (report.nextStep) console.log(`\nNext\n  ${report.nextStep}`);
}

export async function handleModelsFit(args: string[]): Promise<void> {
  const { detectSystem } = await import("../../config/hardware-detect.js");
  const { loadConfig } = await import("../../config/loader.js");
  const { rankProfiles } = await import("../../models/model-fit.js");
  const { listProfiles } = await import("../../config/profile-registry.js");
  const config = await loadConfig(process.cwd(), { requireModel: false });
  const system = detectSystem(config as any);
  const opts: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--role" && args[i + 1]) opts.role = args[++i];
    if (args[i] === "--mode" && args[i + 1]) opts.mode = args[++i];
    if (args[i] === "--json") opts.json = "true";
  }
  const results = rankProfiles(system, listProfiles(), opts);
  if (opts.json) { console.log(JSON.stringify(results, null, 2)); return; }
  console.log("\nRecommended Profiles\n");
  results.forEach((r, i) => {
    console.log(`${i + 1}. ${r.profile.id.padEnd(20)} ${r.status === "best fit" ? "✅ best fit" : r.status === "alternative" ? `⚠️ ${r.compatibility} — best available` : "❌ not recommended"}`);
    r.reasons.forEach(rs => console.log(`   ${rs}`)); console.log();
  });
  const best = results[0];
  if (best && best.status !== "not recommended") console.log(`Suggested command:\n  alix models install-profile ${best.profile.id}`);
}

export async function handleModelsList(args: string[]): Promise<void> {
  const { listProfiles, matchHardware } = await import("../../config/profile-registry.js");
  const { detectSystem } = await import("../../config/hardware-detect.js");
  const { loadConfig } = await import("../../config/loader.js");
  const config = await loadConfig(process.cwd(), { requireModel: false });
  const system = detectSystem(config as any);
  const profiles = listProfiles();
  if (args.includes("--json")) { console.log(JSON.stringify(profiles, null, 2)); return; }
  console.log("\nAvailable Profiles\n");
  for (const p of profiles) {
    const m = matchHardware(p, system);
    const icon = m.status === "compatible" ? "✅" : m.status === "partial" ? "⚠️" : "❌";
    console.log(`  ${icon} ${p.id.padEnd(22)} ${p.name}${config.modelProfile === p.id ? " (active)" : ""}`);
    console.log(`     ${p.description}`);
    console.log(`     Mode: ${p.mode} | RAM: ${p.hardware.minRamGb}-${p.hardware.recommendedRamGb} GB\n`);
  }
}

export async function handleModelsShow(args: string[]): Promise<void> {
  const { showProfileDetail } = await import("../../models/model-install.js");
  const id = args.find(a => !a.startsWith("--"));
  if (!id) { console.error("Usage: alix models show-profile <id> [--json]"); process.exit(1); }
  const profile = showProfileDetail(id);
  if (!profile) { console.error(`Unknown profile: ${id}`); process.exit(1); }
  if (args.includes("--json")) { console.log(JSON.stringify(profile, null, 2)); return; }
  console.log(`\n${profile.name} (${profile.id})`);
  console.log(`  ${profile.description}`);
  console.log(`  Mode: ${profile.mode}`);
  console.log(`  Hardware: ${profile.hardware.minRamGb}–${profile.hardware.recommendedRamGb} GB RAM${profile.hardware.requiresGpu ? ", GPU required" : ""}`);
  console.log("\nTiers:");
  for (const [tier, model] of Object.entries(profile.models)) console.log(`  ${tier.padEnd(12)} ${model.provider}/${model.name}`);
  if (profile.fallbacks?.enabled) {
    console.log("\nFallbacks:");
    if (profile.fallbacks.cloud) console.log(`  cloud  ${profile.fallbacks.cloud.provider}/${profile.fallbacks.cloud.name}`);
    if (profile.fallbacks.local) console.log(`  local  ${profile.fallbacks.local.provider}/${profile.fallbacks.local.name}`);
  }
}

export async function handleModelsApply(args: string[]): Promise<void> {
  const { applyProfile } = await import("../../models/model-install.js");
  const id = args.find(a => !a.startsWith("--"));
  if (!id) { console.error("Usage: alix models apply-profile <id> [--dry-run]"); process.exit(1); }
  const result = await applyProfile(id, process.cwd(), args.includes("--dry-run"));
  console.log(result.message);
  if (result.changes && args.includes("--dry-run")) {
    console.log("\nWould write:");
    for (const [k, v] of Object.entries(result.changes)) console.log(`  ${k}: ${JSON.stringify(v)}`);
    console.log("\nPreserved:");
    for (const s of result.preserved || []) console.log(`  ${s}`);
  }
  if (!result.success) process.exit(1);
}

export async function handleModelsInstall(args: string[]): Promise<void> {
  const { installProfile } = await import("../../models/model-install.js");
  const id = args.find(a => !a.startsWith("--"));
  if (!id) { console.error("Usage: alix models install-profile <id> [--dry-run]"); process.exit(1); }
  const result = await installProfile(id, process.cwd(), args.includes("--dry-run"));
  console.log(result.message);
  if (!result.success) process.exit(1);
}

export async function handleModelsResolve(args: string[]): Promise<void> {
  const { loadConfig } = await import("../../config/loader.js");
  const { getProfile } = await import("../../config/profile-registry.js");
  const { PROFILE_TIER_MAP } = await import("../../config/profile-types.js");
  const role = args.find(a => !a.startsWith("--"));
  const profileId = args.indexOf("--profile") >= 0 ? args[args.indexOf("--profile") + 1] : undefined;
  const config = await loadConfig(process.cwd());
  const activeProfileId = profileId || config.modelProfile;
  const profile = activeProfileId ? getProfile(activeProfileId) : undefined;
  // Canonical resolution: read `models.<tier>` (§2.3 — subagent projections
  // never participate in resolution). PROFILE_TIER_MAP is the single
  // profile-vocabulary → canonical-tier mapping (§5.2) — no local tier map.
  const modelFor = (vocabKey: string): { provider?: string; name?: string } | undefined => {
    const tier = PROFILE_TIER_MAP[vocabKey as keyof typeof PROFILE_TIER_MAP] ?? vocabKey;
    const models = config.models as Record<string, { provider?: string; name?: string }> | undefined;
    // §3.1: models[tier] ?? models.default — a missing tier falls back to default.
    return models?.[tier] ?? models?.default;
  };
  if (role) {
    const m = modelFor(role);
    console.log(`Role: ${role}\nProvider: ${m?.provider || "unknown"}\nModel: ${m?.name || "unknown"}`);
    if (activeProfileId) console.log(`Source: profile ${activeProfileId}`);
  } else {
    for (const t of ["default","planner","coder","critic","researcher","embeddings"]) {
      const m = modelFor(t);
      console.log(`${t.padEnd(12)} ${m?.provider || "default"}/${m?.name || "default"}${profile ? ` (from ${profile.id})` : ""}`);
    }
  }
}

/**
 * Persist a model selection under the canonical `models` object (§8.1/§8.3).
 *
 * Reads ONLY the target config file (project or user) so config layering is
 * preserved — a loadConfig merge would bake the other layer's settings into
 * this file. The derived `model`/`subagents` projections are stripped through
 * the persistence boundary, the selection is MERGED into `models` (never
 * replacing the object, so unrelated tiers survive), and the result is written
 * through the shared writeConfig(). Never calls normalizeModelConfig (§8.4).
 *
 * @returns the config path that was written.
 */
export async function persistModelSelection(
  cwd: string,
  tier: ModelTier,
  selection: { provider: string; name: string },
): Promise<string> {
  const { readFile, mkdir } = await import("node:fs/promises");
  const { existsSync } = await import("node:fs");
  const { homedir } = await import("node:os");
  const { join } = await import("node:path");
  const { withoutDerivedModelProjections, writeConfig } = await import("../../config/persistence.js");
  const { projectConfigDir } = await import("../../config/loader.js");

  const projectConfigPath = join(cwd, ".alix", "config.json");
  const userConfigDir = join(homedir(), ".config", "alix");
  const userConfigPath = join(userConfigDir, "config.json");
  const configPath = existsSync(join(cwd, ".git")) ? projectConfigPath : userConfigPath;
  const configDir = configPath === projectConfigPath ? projectConfigDir(cwd) : userConfigDir;

  // The on-disk file is a partial overlay (may lack defaulted sections), not a
  // full runtime AlixConfig — hence the cast. `withoutDerivedModelProjections`
  // only reads the fields it strips plus the canonical `models`, and preserves
  // `subagents.enabled`/`roles` behavior config (§2.8.1), so a raw partial is
  // a safe input and the cast stays isolated to this writer.
  let existing: Record<string, unknown> = {};
  try { existing = JSON.parse(await readFile(configPath, "utf8")); } catch { /* no config yet */ }

  const persisted = withoutDerivedModelProjections(existing as unknown as import("../../config/schema.js").AlixConfig);
  persisted.models = {
    ...(persisted.models ?? {}),
    [tier]: { provider: selection.provider, name: selection.name },
  };

  await mkdir(configDir, { recursive: true });
  await writeConfig(persisted, configPath);
  return configPath;
}

/**
 * Resolve the `set-tier` argument against the canonical non-default tier
 * vocabulary (§8.2). Returns undefined for anything outside
 * MODEL_SUBAGENT_TIERS — including "default" (owned by set-default) and
 * profile vocabulary (coder/planner/…) or arbitrary strings.
 *
 * `MODEL_SUBAGENT_TIERS` is exactly `MODEL_TIER_VALUES` minus "default", so a
 * single `isModelTier` membership check plus the default exclusion is
 * equivalent to a second `includes()` lookup.
 */
export function resolveTierArg(name: string | undefined): (typeof MODEL_SUBAGENT_TIERS)[number] | undefined {
  if (!name || !isModelTier(name) || name === "default") return undefined;
  return name as (typeof MODEL_SUBAGENT_TIERS)[number];
}

/** Shared interactive flow: pick a provider (with API key) then a model. */
async function selectProviderAndModel(): Promise<{ providerId: string; model: ModelInfo }> {
  const { resolveProviders, getAvailableModels, selectFromList, selectModelInteractive } = await import("../helpers/provider-selection.js");
  const { getApiKey, setApiKey } = await import("../helpers/api-keys.js");
  const { prompt } = await import("./prompt.js");

  const avail = await resolveProviders();
  const pick = await selectFromList(
    avail,
    (p) => `${p.name} — ${p.apiKeySource}${p.reason ? ` (${p.reason})` : ""}`,
    { header: "Select a provider:" },
  );
  if (!pick) { console.log("Cancelled."); process.exit(0); }

  let apiKey = await getApiKey(pick.id);
  if (apiKey === undefined) {
    console.log(`\nNo API key found for ${pick.name}.`);
    const key = await prompt(`Enter API key (${pick.hint}): `);
    if (!key) { console.log("Cancelled."); process.exit(0); }
    await setApiKey(pick.id, key);
    apiKey = key;
    process.env[pick.env] = key;
  }

  console.log(`\nFetching available models for ${pick.name}...\n`);
  const models = await getAvailableModels(pick.id);
  if (models.length === 0) { console.log("No models found."); process.exit(1); }
  const selected = await selectModelInteractive(models);
  if (!selected) { console.log("Cancelled."); process.exit(0); }
  return { providerId: pick.id, model: selected };
}

export async function handleModelsSetDefault(_args: string[]): Promise<void> {
  const { providerId, model } = await selectProviderAndModel();
  const configPath = await persistModelSelection(process.cwd(), "default", { provider: providerId, name: model.id });
  console.log(`\nDefault model set to "${model.id}" for ${providerId}.`);
  console.log(`Saved to ${configPath}`);
}

export async function handleModelsSetTier(args: string[]): Promise<void> {
  const { prompt } = await import("./prompt.js");
  const TIER_DESC: Record<string, string> = {
    thinking: "Strategic reasoning, planning, complex logic",
    coding: "Code generation, tool execution, patches",
    fast: "Quick classification, routing, simple tasks",
    critic: "Verification, validation, hallucination checks",
    tiny: "Embeddings, reranking, memory compression",
    image: "Image generation, multimodal analysis",
  };

  let tierName = resolveTierArg(args.find((a) => !a.startsWith("--")));
  if (!tierName) {
    console.log("\nSelect a subagent tier to configure:");
    for (let i = 0; i < MODEL_SUBAGENT_TIERS.length; i++) {
      const t = MODEL_SUBAGENT_TIERS[i];
      console.log(`  ${i + 1}. ${t} - ${TIER_DESC[t]}`);
    }
    const answer = await prompt(`\nSelect tier (1-${MODEL_SUBAGENT_TIERS.length}, 0 to cancel): `);
    const num = parseInt(answer, 10);
    if (num === 0 || isNaN(num) || num > MODEL_SUBAGENT_TIERS.length) { console.log("Cancelled."); process.exit(0); }
    tierName = MODEL_SUBAGENT_TIERS[num - 1];
  }

  const { providerId, model } = await selectProviderAndModel();
  const configPath = await persistModelSelection(process.cwd(), tierName, { provider: providerId, name: model.id });
  console.log(`\nTier "${tierName}" set to ${providerId}/${model.id}.`);
  console.log(`Saved to ${configPath}`);
}

const HANDLERS: Record<string, (args: string[]) => Promise<void>> = {
  "doctor": handleModelsDoctor,
  "fit": handleModelsFit,
  "list-profiles": handleModelsList,
  "show-profile": handleModelsShow,
  "apply-profile": handleModelsApply,
  "install-profile": handleModelsInstall,
  "resolve": handleModelsResolve,
  "set-default": handleModelsSetDefault,
  "set-tier": handleModelsSetTier,
  "free": handleModelsFree,
  "routing": handleModelsRouting,
};

const NO_FREE_MODELS_MESSAGE = "No OpenRouter free models available. Set OPENROUTER_API_KEY and retry.";

export async function handleModelsFree(args: string[]): Promise<void> {
  const { fetchFreeModelCatalog } = await import("../../providers/free-model-catalog.js");
  let models: Awaited<ReturnType<typeof fetchFreeModelCatalog>>;
  try {
    models = await fetchFreeModelCatalog();
  } catch (err) {
    console.log(NO_FREE_MODELS_MESSAGE);
    if (process.env.NODE_ENV === "test") console.error(String((err as Error)?.message ?? err));
    return;
  }
  if (models.length === 0) {
    console.log(NO_FREE_MODELS_MESSAGE);
    return;
  }
  if (args.includes("--json")) { console.log(JSON.stringify(models, null, 2)); return; }
  console.log("\nOpenRouter Free Models\n");
  for (const m of models) {
    const ctx = m.inputTokenLimit ? `${(m.inputTokenLimit / 1000).toFixed(0)}k` : "?";
    const caps = [
      ...(m.supportsTools ? ["tools"] : []),
      ...(m.supportsStructuredOutput ? ["structured"] : []),
      ...(m.supportsVision ? ["vision"] : []),
    ];
    const capText = caps.length > 0 ? ` [${caps.join(",")}]` : "";
    console.log(`  ${m.id.padEnd(28)} ${ctx.padEnd(6)}${capText}`);
  }
  console.log(`\n${models.length} free models.`);
}

export async function handleModelsRouting(args: string[]): Promise<void> {
  const { loadConfig } = await import("../../config/loader.js");
  const { describeRoutingChain } = await import("../../models/routing-cli.js");
  const { NO_MODEL_CONFIGURED_MESSAGE } = await import("../../config/model-resolver.js");
  const config = await loadConfig(process.cwd(), { requireModel: false });
  let chain: Array<{ provider: string; model: string; role: string }>;
  try {
    chain = describeRoutingChain(config);
  } catch (err) {
    if (err instanceof Error && err.message === NO_MODEL_CONFIGURED_MESSAGE) {
      console.log(`\n${NO_MODEL_CONFIGURED_MESSAGE}`);
      process.exit(1);
    }
    throw err;
  }
  if (args.includes("--json")) { console.log(JSON.stringify(chain, null, 2)); return; }
  console.log("\nConfigured Routing Chain\n");
  for (const c of chain) console.log(`  ${c.role.padEnd(9)} ${c.provider}/${c.model}`);
  if (chain.length === 1) {
    console.log("\nNo fallbacks configured. Add under models.default in config:");
    console.log('  "routing": { "freeFallback": true }    # OpenRouter free-tier fallback');
    console.log('  "routing": { "fallbacks": [...] }      # explicit ordered candidates');
  }
}

export async function handleModelsCommand(args: string[]): Promise<void> {
  const sub = args[0];
  const handler = HANDLERS[sub];
  if (!handler) {
    console.error("Usage: alix models <doctor|fit|list-profiles|show-profile|apply-profile|install-profile|resolve|set-default|set-tier|free|routing>");
    console.error("  alix models doctor               Run system and profile diagnostic");
    console.error("  alix models fit                   Rank profiles by hardware fit");
    console.error("  alix models list-profiles         List available profiles");
    console.error("  alix models show-profile <id>     Show profile details");
    console.error("  alix models apply-profile <id>    Apply a profile to config");
    console.error("  alix models install-profile <id>  Pull models and apply profile");
    console.error("  alix models resolve               Show effective model per role");
    console.error("  alix models resolve <role>        Show effective model for a specific role");
    console.error("  alix models set-default           Set the default model (interactive)");
    console.error("  alix models set-tier <tier>       Set a subagent tier model (thinking/coding/fast/critic/tiny/image)");
    console.error("  alix models free                  List OpenRouter free models");
    console.error("  alix models routing               Show the configured routing chain");
    process.exit(1);
  }
  await handler(args.slice(1));
}
