/**
 * `alix policy / registry / runtime` subcommands — extracted from `src/cli.ts`
 * (#717 step 6). Bodies moved verbatim; each handler terminates via `process.exit`.
 */

import "node:fs";
import { join } from "node:path";
import "../../config/model-resolver.js";
import "../../index.js";
import "./prompt.js";
import "../helpers/api-keys.js";
import "../../providers/catalog.js";

export async function handlePolicyRoot(args: string[]): Promise<void> {
  const { loadRuleEvaluator } = await import("../../policy/policy-loader.js");
  const { existsSync, readdirSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const cwd = process.cwd();

  if (args[0] === "list") {
    const evaluator = await loadRuleEvaluator(cwd);
    const rules = evaluator.getAllRules();
    if (rules.length === 0) {
      console.log("No policy rules loaded.");
    } else {
      console.log(`${"ID".padEnd(22)} ${"Decision".padEnd(10)} ${"Enabled".padEnd(8)} Match`);
      console.log("-".repeat(90));
      for (const r of rules) {
        const matchParts: string[] = [];
        if (r.match.capability) matchParts.push(`capability=${r.match.capability}`);
        if (r.match.toolId) matchParts.push(`toolId=${r.match.toolId}`);
        if (r.match.riskLevel) matchParts.push(`riskLevel=${r.match.riskLevel}`);
        if (r.match.executionProfile) matchParts.push(`profile=${r.match.executionProfile}`);
        if (r.match.pathPattern) matchParts.push(`path=${r.match.pathPattern}`);
        console.log(`${r.id.padEnd(22)} ${r.decision.padEnd(10)} ${(r.enabled ? "✓" : "✗").padEnd(8)} ${matchParts.join(", ")}`);
      }
      console.log(`\n${rules.filter(r => r.enabled).length}/${rules.length} rules enabled`);
    }
    process.exit(0);
  }

  if (args[0] === "doctor") {
    const policiesDir = join(cwd, ".alix", "policies");
    console.log("Policy Doctor — rule health check\n");
    console.log(`Policy dir: ${policiesDir}`);
    const hasDir = existsSync(policiesDir);
    console.log(`  policies/ ${hasDir ? "✓ exists" : "— not found (using defaults)"}`);

    let validCount = 0;
    let invalidFiles = 0;
    let duplicateIds: string[] = [];
    const seenIds = new Set<string>();
    const { validatePolicyRule } = await import("../../policy/policy-rule.js");

    if (hasDir) {
      const files = readdirSync(policiesDir).filter(f => f.endsWith(".json"));
      console.log(`\nPolicy files: ${files.length} found`);

      for (const f of files) {
        try {
          const raw = readFileSync(join(policiesDir, f), "utf-8");
          const parsed = JSON.parse(raw);
          const items: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
          for (const item of items) {
            const result = validatePolicyRule(item as any);
            if (result.valid) {
              const ruleId = (item as any).id;
              if (seenIds.has(ruleId)) {
                duplicateIds.push(ruleId);
              } else {
                seenIds.add(ruleId);
                validCount++;
              }
            } else {
              console.log(`  ⚠ ${f} — invalid rule: ${result.errors.join("; ")}`);
            }
          }
        } catch {
          console.log(`  ⚠ ${f} — failed to parse JSON`);
          invalidFiles++;
        }
      }
    }

    const evaluator = await loadRuleEvaluator(cwd);
    const totalLoaded = evaluator.getAllRules().length;
    console.log(`\nValid rules: ${validCount}`);
    if (invalidFiles > 0) console.log(`Invalid files: ${invalidFiles}`);
    if (duplicateIds.length > 0) console.log(`Duplicate IDs: ${duplicateIds.join(", ")}`);
    console.log(`Loaded: ${totalLoaded} rules ${hasDir ? "(from disk)" : "(defaults)"}`);

    if (invalidFiles > 0 || duplicateIds.length > 0) {
      console.log("\n⚠️  Recommendation: fix or remove invalid policy files.");
    } else if (totalLoaded > 0) {
      console.log("\n✓ Policy rules are healthy.");
    }
    process.exit(0);
  }

  if (args[0] === "eval") {
    const capIdx = args.indexOf("--capability");
    const riskIdx = args.indexOf("--risk");
    const profileIdx = args.indexOf("--profile");
    const capability = capIdx >= 0 ? args[capIdx + 1] : undefined;
    const riskLevel = riskIdx >= 0 ? args[riskIdx + 1] : undefined;
    const executionProfile = profileIdx >= 0 ? args[profileIdx + 1] : undefined;

    if (!capability && !riskLevel && !executionProfile) {
      console.error("Usage: alix policy eval --capability <cap> [--risk <low|medium|high|critical>] [--profile <profile>]");
      process.exit(1);
    }

    const evaluator = await loadRuleEvaluator(cwd);
    const result = evaluator.evaluate({
      capability,
      riskLevel: riskLevel as any,
      executionProfile,
    });

    const { AuditStore } = await import("../../audit/audit-store.js");
    const audit = new AuditStore(cwd);
    await audit.append({ action: "policy.evaluated", actor: "user", details: {
      capability, policyRuleId: result.matchedRuleId,
      policyDecision: result.decision, reason: result.reason,
    }});

    console.log(`Decision: ${result.decision}`);
    if (result.matchedRuleId) console.log(`Rule:     ${result.matchedRuleId}`);
    if (result.reason) console.log(`Reason:   ${result.reason}`);
    process.exit(0);
  }

  console.log("Usage: alix policy [list|doctor|eval]");
  console.log("  list                List loaded policy rules");
  console.log("  doctor              Check policy file health and loading status");
  console.log("  eval                Evaluate a capability/risk against policy");
  console.log('    --capability <c>    Capability to evaluate (e.g. shell.exec)');
  console.log('    --risk <l|m|h|c>    Risk level');
  console.log('    --profile <p>       Execution profile');
  process.exit(0);
}

export async function handleRegistryRoot(args: string[]): Promise<void> {
  const { loadCardRegistry } = await import("../../registry/card-loader.js");
  const { existsSync } = await import("node:fs");
  const { readdirSync } = await import("node:fs");
  const registry = await loadCardRegistry(process.cwd());

  if (args[0] === "agents" || args[0] === "list") {
    const agents = registry.listAgents(true);
    if (agents.length === 0) {
      console.log("No agent cards loaded.");
    } else {
      console.log(`${"ID".padEnd(24)} ${"Name".padEnd(22)} Enabled  Domains`);
      console.log("-".repeat(80));
      for (const a of agents) {
        console.log(`${a.id.padEnd(24)} ${a.name.slice(0, 20).padEnd(22)} ${(a.enabled ? "✓" : "✗").padEnd(7)} ${a.domains.join(", ")}`);
      }
      console.log(`\n${agents.filter(a => a.enabled).length}/${agents.length} agents enabled`);
    }
    process.exit(0);
  }

  if (args[0] === "tools") {
    const tools = registry.listTools(true);
    if (tools.length === 0) {
      console.log("No tool cards loaded.");
    } else {
      console.log(`${"ID".padEnd(20)} ${"Name".padEnd(22)} Risk${"".padEnd(8)} Modes`);
      console.log("-".repeat(70));
      for (const t of tools) {
        const risk = `${t.riskLevel || "?"}`;
        const modes = t.allowedExecutionProfiles?.join(", ") || "any";
        console.log(`${t.id.padEnd(20)} ${t.name.slice(0, 20).padEnd(22)} ${risk.padEnd(12)} ${modes}`);
      }
      console.log(`\n${tools.length} tools loaded`);
    }
    process.exit(0);
  }

  if (args[0] === "doctor") {
    const cardsDir = join(process.cwd(), ".alix", "cards");
    const agentsDir = join(cardsDir, "agents");
    const toolsDir = join(cardsDir, "tools");

    console.log("Registry Doctor — card health check\n");
    console.log(`Card dir:  ${cardsDir}`);

    // Check directory existence
    const hasAgentDir = existsSync(agentsDir);
    const hasToolDir = existsSync(toolsDir);
    console.log(`  agents/  ${hasAgentDir ? "✓ exists" : "— not found (using defaults)"}`);
    console.log(`  tools/   ${hasToolDir ? "✓ exists" : "— not found (using defaults)"}`);

    // Scan files
    let invalidFiles: string[] = [];
    let totalFiles = 0;

    if (hasAgentDir) {
      const files = readdirSync(agentsDir).filter(f => f.endsWith(".json"));
      totalFiles += files.length;
      for (const f of files) {
        try {
          const data = JSON.parse(await import("node:fs").then(fs => fs.readFileSync(join(agentsDir, f), "utf-8")));
          const { validateAgentCard } = await import("../../registry/agent-card.js");
          const result = validateAgentCard(data);
          if (!result.valid) invalidFiles.push(`  ✗ ${f} — ${result.errors.join("; ")}`);
        } catch (err: any) {
          invalidFiles.push(`  ✗ ${f} — ${err.message || String(err)}`);
        }
      }
    }

    if (hasToolDir) {
      const files = readdirSync(toolsDir).filter(f => f.endsWith(".json"));
      totalFiles += files.length;
      for (const f of files) {
        try {
          const data = JSON.parse(await import("node:fs").then(fs => fs.readFileSync(join(toolsDir, f), "utf-8")));
          const { validateToolCard } = await import("../../registry/tool-card.js");
          const result = validateToolCard(data);
          if (!result.valid) invalidFiles.push(`  ✗ ${f} — ${result.errors.join("; ")}`);
        } catch (err: any) {
          invalidFiles.push(`  ✗ ${f} — ${err.message || String(err)}`);
        }
      }
    }

    console.log(`\nCard files: ${totalFiles} found, ${invalidFiles.length} invalid`);

    if (invalidFiles.length > 0) {
      console.log("\nInvalid cards:");
      for (const msg of invalidFiles) console.log(msg);
    }

    // Show what loaded
    const agents = registry.listAgents(true);
    const tools = registry.listTools(true);
    const loadedFromDisk = hasAgentDir || hasToolDir;
    console.log(`\nLoaded: ${agents.length} agents, ${tools.length} tools ${loadedFromDisk ? "(from disk)" : "(defaults)"}`);

    if (invalidFiles.length > 0) {
      console.log("\n⚠️  Recommendation: fix or remove invalid card files to ensure correct capability resolution.");
    } else if (agents.length > 0 || tools.length > 0) {
      console.log("\n✓ Registry is healthy.");
    }
    process.exit(0);
  }

  // Default: show usage
  console.log("Usage: alix registry [list|agents|tools|doctor]");
  console.log("  list           List all loaded agents and tools");
  console.log("  agents         List agent cards only");
  console.log("  tools          List tool cards only");
  console.log("  doctor         Check card file health and loading status");
  process.exit(0);
}

export async function handleRuntimeRoot(args: string[]): Promise<void> {
  const { buildRuntimeIndex } = await import("../../runtime/runtime-index.js");
  const cwd = process.cwd();

  if (args[0] === "events") {
    const idx = await buildRuntimeIndex(cwd);
    const limitIdx = args.indexOf("--limit");
    const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) || 50 : 50;
    const graphIdx = args.indexOf("--graph");
    const sessionIdx = args.indexOf("--session");
    const approvalIdx = args.indexOf("--approval");
    const actionIdx = args.indexOf("--action");

    let filtered = [...idx.events];
    if (graphIdx >= 0) filtered = filtered.filter(e => e.graphId === args[graphIdx + 1]);
    if (sessionIdx >= 0) filtered = filtered.filter(e => e.sessionId === args[sessionIdx + 1]);
    if (approvalIdx >= 0) filtered = filtered.filter(e => e.approvalId === args[approvalIdx + 1]);
    if (actionIdx >= 0) filtered = filtered.filter(e => e.action === args[actionIdx + 1]);
    filtered = filtered.slice(0, limit);

    if (filtered.length === 0) { console.log("No matching events."); process.exit(0); }
    for (const e of filtered) {
      console.log(`${(e.source + ":" + e.action).padEnd(32)} ${e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : "?"}  ${e.graphId ? "graph=" + e.graphId : ""}${e.nodeId ? " node=" + e.nodeId : ""}${e.capability ? " cap=" + e.capability : ""}`);
      if (e.summary) console.log(`  ${e.summary.slice(0, 120)}`);
    }
    console.log(`\n${filtered.length} events`);
    process.exit(0);
  }

  if (args[0] === "timeline") {
    const graphId = args[1];
    if (!graphId) { console.error("Usage: alix runtime timeline <graphId>"); process.exit(1); }
    const idx = await buildRuntimeIndex(cwd);
    const events = idx.byGraph(graphId).slice(0, 100).reverse(); // oldest first for timeline
    if (events.length === 0) { console.log("No events for graph."); process.exit(0); }
    for (const e of events) {
      const time = e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : "?";
      console.log(`  [${time}] ${e.source}:${e.action} ${e.nodeId ? "node=" + e.nodeId : ""}${e.status ? " (" + e.status + ")" : ""}`);
      if (e.summary) console.log(`    ${e.summary.slice(0, 100)}`);
    }
    console.log(`\n${events.length} events`);
    process.exit(0);
  }

  console.log("Usage: alix runtime [events|timeline]");
  console.log("  events [--graph <g>] [--session <s>] [--approval <a>] [--action <a>] [--limit N]");
  console.log("  timeline <graphId>");
  process.exit(0);
}

