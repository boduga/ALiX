/**
 * `alix skill` subcommands — extracted from `src/cli.ts`
 * (#717 step 6). Bodies moved verbatim; each handler terminates via `process.exit`.
 */

import "node:fs";
import "../../config/model-resolver.js";
import "../../index.js";
import "./prompt.js";
import "../helpers/api-keys.js";
import "../../providers/catalog.js";

export async function handleSkillRoot(args: string[]): Promise<void> {
  const { homedir } = await import("node:os");
  const { join: pjoin, dirname } = await import("node:path");
  const { readFile } = await import("node:fs/promises");
  const { ExtensionRegistry } = await import("../../extensions/registry.js");
  const { SkillLoader } = await import("../../extensions/skill-loader.js");

  const storePath = pjoin(homedir(), ".alix", "extensions");
  const registry = new ExtensionRegistry(storePath);

  const sub = args[0];
  if (sub === "list") {
    const skills = registry.list({ type: "skill" });
    console.log(`Installed skills (${skills.length}):`);
    for (const ext of skills) {
      const m = ext.manifest;
      const trigger = (m as any).trigger ? ` trigger:${(m as any).trigger}` : "";
      console.log(`  ${m.name.padEnd(15)} — ${m.description} (v${m.version})${trigger}`);
    }
  } else if (sub === "show") {
    const id = args[1];
    if (!id) { console.error("Usage: alix skill show <id>"); process.exit(1); }
    const ext = registry.get(`skill/${id}`);
    if (!ext) { console.error(`Skill not found: ${id}`); process.exit(1); }
    const m = ext.manifest;
    const skillDir = dirname(ext.path);
    console.log(`Skill: ${m.name}`);
    console.log(`  Name:        ${m.name}`);
    console.log(`  Version:     ${m.version}`);
    console.log(`  Description: ${m.description}`);
    console.log(`  Type:        ${m.type}`);
    console.log(`  Trigger:     ${(m as any).trigger ?? "none"}`);
    console.log(`  Path:        ${skillDir}/`);
    console.log();

    // Load SKILL.md for preview
    let skillContent: string | null = null;
    try {
      skillContent = await readFile(pjoin(skillDir, "SKILL.md"), "utf8");
    } catch { /* SKILL.md may not exist */ }
    if (skillContent) {
      const lines = skillContent.split("\n");
      const preview = lines.slice(0, 20).join("\n");
      console.log(`  SKILL.md (first 20 lines):`);
      console.log(preview);
    } else {
      console.log("  SKILL.md: (not found)");
    }
  } else if (sub === "install") {
    const src = args[1];
    if (!src) { console.error("Usage: alix skill install <path>"); process.exit(1); }
    const installed = await registry.install(src);
    if (installed) {
      console.log(`Installed: ${installed.manifest.name} (v${installed.manifest.version})`);
    } else {
      console.error("Install failed: no EXTENSION.yaml found or manifest invalid");
      process.exit(1);
    }
  } else if (sub === "run") {
    const id = args[1];
    if (!id) { console.error("Usage: alix skill run <id> [--input '...'] [--prompt '...'] [--json] [--intent] [--propose]"); process.exit(1); }
    const ext = registry.get(`skill/${id}`);
    if (!ext) { console.error(`Skill not found: ${id}`); process.exit(1); }

    // Parse flags from args (skip sub and id at positions 0-1)
    const restArgs = args.slice(2);
    const inputIdx = restArgs.indexOf("--input");
    const promptIdx = restArgs.indexOf("--prompt");
    const jsonFlag = restArgs.includes("--json");
    const intentFlag = restArgs.includes("--intent");
    const proposeFlag = restArgs.includes("--propose");

    let inputJson: Record<string, string> | undefined;
    if (inputIdx >= 0 && restArgs[inputIdx + 1]) {
      try {
        inputJson = JSON.parse(restArgs[inputIdx + 1]);
      } catch {
        console.error("Invalid JSON for --input");
        process.exit(1);
      }
    }

    const promptText = (promptIdx >= 0 && restArgs[promptIdx + 1])
      ? restArgs[promptIdx + 1]
      : undefined;

    const m = ext.manifest;
    const skillDir = dirname(ext.path);
    const loader = new SkillLoader(skillDir);
    const loaded = await loader.load("SKILL", inputJson);
    if (!loaded) {
      console.error(`Failed to load skill: ${id} (SKILL.md not found in ${skillDir})`);
      process.exit(1);
    }

    const substitutedCount = inputJson
      ? loaded.variables.filter(v => v in inputJson).length
      : 0;

    if (jsonFlag) {
      console.log(JSON.stringify({
        skill: m.name,
        version: m.version,
        content: loaded.content,
        variables: loaded.variables,
        substituted: substitutedCount,
      }, null, 2));
    } else {
      console.log(`Skill: ${m.name}`);
      console.log("─".repeat(28));
      console.log(loaded.content);
      console.log("─".repeat(28));
      console.log(`Rendered skill (${substitutedCount} variable${substitutedCount !== 1 ? "s" : ""} substituted)`);
    }

    // --intent / --propose: capture skill execution as an ExecutionIntent artifact
    // --propose is a superset of --intent: it also maps the intent to a proposal
    if (intentFlag || proposeFlag) {
      const { IntentStore } = await import("../../adaptation/intent-store.js");
      const intentDir = pjoin(homedir(), ".alix", "execution", "intents");
      const store = new IntentStore(intentDir);

      const inputText = [
        inputJson ? `--input: ${JSON.stringify(inputJson)}` : null,
        promptText ? `--prompt: ${promptText}` : null,
      ].filter(Boolean).join("; ") || "(no input)";

      const outputSummary = loaded.content.slice(0, 200);

      const intent: Record<string, unknown> = {
        source: "skill_run" as const,
        skillId: id,
        input: inputText,
        outputSummary,
        status: "captured" as const,
        rationale: `Skill run: ${m.name} — ${substitutedCount} variable(s) substituted`,
        sourceArtifacts: [
          { type: "context" as const, id: `skill:${id}` },
        ],
        subject: `Skill run: ${m.name}`,
        outcome: "captured",
        confidence: 1,
        reasons: [`Skill "${m.name}" (${id}) rendered with ${substitutedCount} substituted variable(s)`],
      };

      // --propose: attach proposedAction + proposedTarget for proposal mapping
      if (proposeFlag) {
        intent.proposedAction = "adjust_skill_definition";
        intent.proposedTarget = { kind: "skill", id };
      }

      await store.append(intent as any);

      // Terminal output — intent captured
      console.log(`\nIntent captured: ${(intent as any).id || "(id pending)"}`);
      console.log(`  Source:  skill_run (${id})`);
      console.log(`  Status:  captured`);
      console.log(`  Summary: ${outputSummary.slice(0, 80)}${outputSummary.length > 80 ? "..." : ""}`);

      // --propose: map intent to proposal
      if (proposeFlag) {
        const { homedir: _getHomedir } = await import("node:os");
        const { join: pathJoin } = await import("node:path");
        const { AdaptationProposalStore } = await import("../../adaptation/adaptation-proposal-store.js");
        const { IntentProposalMapper } = await import("../../adaptation/intent-proposal-mapper.js");

        const proposalsDir = pathJoin(process.cwd(), ".alix", "adaptation", "proposals");
        const proposalStore = new AdaptationProposalStore(proposalsDir);
        const mapper = new IntentProposalMapper(proposalStore);

        const result = await mapper.mapToProposal(intent as any, store);

        if (!result.success) {
          console.error(`\n  Proposal mapping failed: ${result.errors.join("; ")}`);
        } else {
          console.log(`\n  ✅ Proposal created: ${result.proposal!.id}`);
          console.log(`  Action: ${intent.proposedAction}`);
          console.log(`  Target: ${JSON.stringify(intent.proposedTarget)}`);
          console.log();
          console.log(`  ═══ NEXT STEPS ═══`);
          console.log(`  Proposal created. Use \`alix decision approve ${result.proposal!.id}\``);
          console.log(`  and \`alix decision apply ${result.proposal!.id}\` to execute.`);
          console.log();
        }
      }
    }

    // --prompt: future provider integration slot
    if (promptText) {
      console.log(`\n(prompt="..." received — provider dispatch not yet implemented)`);
    }
  } else {
    console.log("Usage: alix skill [list|show|install|run]");
    console.log("  list              — list installed skills");
    console.log("  show <id>         — show skill details and SKILL.md content");
    console.log("  install <path>    — install a skill from a directory");
    console.log("  run <id>          — render and optionally run a skill");
    console.log("    --input '{...}' — JSON variables for substitution");
    console.log("    --prompt '...'  — additional prompt context");
    console.log("    --json          — output rendered skill as JSON");
  }
  process.exit(0);
}

