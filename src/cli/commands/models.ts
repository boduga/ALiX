/**
 * models.ts — CLI commands for model profile management.
 * Thin wrappers; all logic lives in src/models/*.ts and src/config/*.ts.
 */

export async function handleModelsDoctor(args: string[]): Promise<void> {
  const { detectSystem } = await import("../../config/hardware-detect.js");
  const { loadConfig } = await import("../../config/loader.js");
  const { runDoctor } = await import("../../models/model-doctor.js");
  const { listProfiles } = await import("../../config/profile-registry.js");
  const config = await loadConfig(process.cwd());
  const system = detectSystem(config as any);
  const report = runDoctor(system, config as any, listProfiles(), config.modelProfile);
  if (args.includes("--json")) { console.log(JSON.stringify(report, null, 2)); return; }
  console.log("\nALiX Model Doctor\n");
  for (const sec of report.sections) {
    console.log(sec.title);
    for (const i of sec.items) console.log(`  ${i.startsWith("  ") ? i : `  ${i}`}`);
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
  const config = await loadConfig(process.cwd());
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
    console.log(`${i + 1}. ${r.profile.id.padEnd(20)} ${r.status === "best fit" ? "✅ best fit" : r.status === "compatible" ? "✅ compatible" : "⚠️ not recommended"}`);
    r.reasons.forEach(rs => console.log(`   ${rs}`)); console.log();
  });
  const best = results[0];
  if (best && best.status !== "not recommended") console.log(`Suggested command:\n  alix models install-profile ${best.profile.id}`);
}

export async function handleModelsList(args: string[]): Promise<void> {
  const { listProfiles, matchHardware } = await import("../../config/profile-registry.js");
  const { detectSystem } = await import("../../config/hardware-detect.js");
  const { loadConfig } = await import("../../config/loader.js");
  const config = await loadConfig(process.cwd());
  const system = detectSystem(config as any);
  const profiles = listProfiles();
  if (args.includes("--json")) { console.log(JSON.stringify(profiles, null, 2)); return; }
  console.log("\nAvailable Profiles\n");
  for (const p of profiles) {
    const m = matchHardware(p, system);
    const icon = m === "compatible" ? "✅" : m === "partial" ? "⚠️" : "❌";
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
  const result = applyProfile(id, process.cwd(), args.includes("--dry-run"));
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

const HANDLERS: Record<string, (args: string[]) => Promise<void>> = {
  "doctor": handleModelsDoctor,
  "fit": handleModelsFit,
  "list-profiles": handleModelsList,
  "show-profile": handleModelsShow,
  "apply-profile": handleModelsApply,
  "install-profile": handleModelsInstall,
};

export async function handleModelsCommand(args: string[]): Promise<void> {
  const sub = args[0];
  const handler = HANDLERS[sub];
  if (!handler) {
    console.error("Usage: alix models <doctor|fit|list-profiles|show-profile|apply-profile|install-profile>");
    console.error("  alix models doctor               Run system and profile diagnostic");
    console.error("  alix models fit                   Rank profiles by hardware fit");
    console.error("  alix models list-profiles         List available profiles");
    console.error("  alix models show-profile <id>     Show profile details");
    console.error("  alix models apply-profile <id>    Apply a profile to config");
    console.error("  alix models install-profile <id>  Pull models and apply profile");
    process.exit(1);
  }
  await handler(args.slice(1));
}
