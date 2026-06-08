#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig, DEFAULT_CONFIG } from "./config/loader.js";
import { ALIX_VERSION } from "./index.js";
import { EXIT_CODES, runTask } from "./run.js";
import { ApiError } from "./providers/base.js";
import { PROVIDERS, listModels } from "./providers/catalog.js";
import type { MemoryType } from "./utils/memory/types.js";
import type { ModelInfo } from "./providers/catalog.js";
import { prompt } from "./cli/commands/prompt.js";
import { runChat } from "./cli/commands/chat.js";
import type { ChatOptions } from "./cli/commands/chat.js";

const MEMORY_TYPES = new Set<MemoryType>(["user", "project", "feedback", "reference"]);

async function getSavedApiKey(providerId: string): Promise<string | null> {
  const userConfigPath = join(homedir(), ".config", "alix", "config.json");
  try {
    const data = JSON.parse(await readFile(userConfigPath, "utf8")) as Record<string, unknown>;
    const apiKeys = (data as any).apiKeys ?? {};
    if (typeof apiKeys[providerId] === "string" && apiKeys[providerId]) return apiKeys[providerId];
  } catch { /* no config yet */ }
  return null;
}

async function setApiKey(providerId: string, key: string): Promise<void> {
  // Try user config first (~/.config/alix/config.json)
  const userConfigDir = join(homedir(), ".config", "alix");
  const userConfigPath = join(userConfigDir, "config.json");

  try {
    await mkdir(userConfigDir, { recursive: true });
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(await readFile(userConfigPath, "utf8"));
    } catch {
      // no existing config
    }
    const updated = { ...existing, apiKeys: { ...((existing as any).apiKeys ?? {}), [providerId]: key } };
    await writeFile(userConfigPath, JSON.stringify(updated, null, 2) + "\n");
    console.log(`Saved to ${userConfigPath}`);
  } catch (err) {
    console.error("Failed to write config:", err);
    process.exit(1);
  }
}

async function selectProvider(): Promise<string> {
  console.log("Select a provider to configure:\n");
  for (let i = 0; i < PROVIDERS.length; i++) {
    const p = PROVIDERS[i];
    console.log(`  ${i + 1}. ${p.name} (${p.env})`);
  }
  console.log(`  0. Cancel\n`);

  const answer = await prompt("Enter number: ");
  const num = parseInt(answer, 10);

  if (num === 0 || isNaN(num) || num > PROVIDERS.length) {
    console.log("Cancelled.");
    process.exit(0);
  }

  return PROVIDERS[num - 1].id;
}

const [, , command, ...args] = process.argv;

if (!command || command === "--help" || command === "-h") {
  console.log(`ALiX ${ALIX_VERSION}

Usage:
  alix run "<task>"        Plans first, then executes (approve/reject/edit the plan)
  alix run "<task>" --no-plan  Execute directly without planning phase
  alix run "<task>" --no-stream  Disable streaming output
  alix run "<task>" --mode=auto|ask|bypass  Set session permission mode
  alix run --resume <id>  Resume an interrupted session
  alix session list       List past sessions
  alix session show <id>  Show session details
  alix graph plan "<task>"  Plan a multi-node TaskGraph (dry-run, no execution)
  alix graph list         List saved graphs
  alix graph inspect <id> Show graph node details and status
  alix graph export <id> --format mermaid|json  Export graph
  alix graph run <id>     Execute a planned graph sequentially
  alix graph rerun <id> --node <id>  Rerun a failed graph node
  alix sop list           List registered SOPs
  alix sop run <id> --topic "<topic>"  Run an SOP (--plan-only to skip execution)
  alix report list        List report artifacts
  alix report show <id>   Show report metadata and artifacts
  alix report open <id>   Print final report to stdout
  alix report path <id>   Print absolute path to report directory
  alix metrics            Show M0.9 metrics for latest session (--raw for per-event)
  alix demo local         Run M0.9 demo (read-only task, kernel artifact display)
  alix db doctor          Check database health
  alix db migrate         Run M0.9 kernel database migration
  alix serve
  alix config show
  alix config set-key     Interactive API key setup for 11 providers
  alix config set-default-model  Interactive model selection (fetches from provider API)
  alix config set-tier [tier]    Set model for a subagent tier (interactive, fetches from provider API)
  alix tui              Launch the terminal UI dashboard for agent sessions
  alix mcp list           List connected MCP servers and their tools
  alix mcp add            Add an MCP server (interactive prompts)
  alix mcp remove <name>  Disconnect an MCP server
  alix mcp discover <pkg> Discover an npm MCP package
  alix mcp test <name>    Test an MCP server connection
  alix init              Initialize project with git, config, and sensible defaults
  alix extension list     List installed extensions
  alix extension install <path>  Install an extension from a directory
  alix extension uninstall <id>   Uninstall an extension (e.g. skill/my-skill)
  alix extension search <query>  Search extensions by name, description, or tag
  alix agent <role> "<prompt>"   Spawn a subagent (explorer|reviewer|test_investigator|docs_researcher|worker)
  alix memory list [--query <text>]  List memory entries
  alix memory add --name <n> --content <c>  Add a memory entry
`);
  process.exit(0);
}

if (command === "--version" || command === "-v") {
  console.log(ALIX_VERSION);
  process.exit(0);
}

if (command === "init") {
  const { runInit } = await import("./cli/commands/init.js");
  await runInit(process.cwd());
  process.exit(0);
}

// --- alix graph --- TaskGraph management ---
if (command === "graph" && args[0] === "plan") {
  const task = args.slice(1).filter(a => a !== "--debug").join(" ");
  if (!task) {
    console.error("Usage: alix graph plan \"<task>\"");
    process.exit(1);
  }
  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  const sessionId = `plan_${Date.now()}`;
  const { GraphPlanner, persistGraph, validateGraphSchema } = await import("./kernel/graph-planner.js");
  const { createWorkflowRun } = await import("./kernel/workflow-run.js");
  const { EventLog } = await import("./events/event-log.js");

  // Create a minimal workflow run for planning
  const sessionDir = join(cwd, ".alix", "sessions", sessionId);
  await mkdir(sessionDir, { recursive: true });
  const planLog = new EventLog(sessionDir);
  await planLog.init();

  const wfRun = createWorkflowRun(sessionId, task);
  const planner = new GraphPlanner({
    modelName: config.model.name,
    modelEndpoint: config.model.provider === "ollama"
      ? "http://localhost:11434/api/generate"
      : undefined,
  });

  console.log(`Planning: ${task}`);
  console.log();

  const result = await planner.plan(task, wfRun.id);

  // Save raw model output if --debug
  const isDebug = args.includes("--debug");
  if (isDebug && result.rawModelOutput) {
    const { writeFile } = await import("node:fs/promises");
    const rawPath = join(cwd, ".alix", "graphs", `${result.graph.id}.raw.txt`);
    await writeFile(rawPath, result.rawModelOutput, "utf-8");
    console.log(`Raw:        ${rawPath}`);
  }

  // Persist graph
  const filePath = await persistGraph(result.graph, cwd);
  console.log(`Graph:      ${result.graph.id}`);
  console.log(`Strategy:   ${result.graph.strategy}`);
  console.log(`Nodes:      ${result.graph.nodes.length}`);
  console.log(`Edges:      ${result.graph.edges.length}`);
  console.log(`Valid:      ${result.valid ? "✓" : "✗"}`);
  console.log(`Saved:      ${filePath}`);
  console.log();

  // Emit graph.created and task.ready events
  for (const node of result.graph.nodes) {
    await planLog.append({
      sessionId, actor: "system", type: "task.ready",
      payload: { nodeId: node.id, graphId: result.graph.id, goal: node.goal },
      meta: { workflowId: wfRun.id, graphId: result.graph.id },
    });
  }
  await planLog.append({
    sessionId, actor: "system", type: "graph.created",
    payload: { graphId: result.graph.id, workflowId: wfRun.id, nodeCount: result.graph.nodes.length },
    meta: { workflowId: wfRun.id },
  });

  // Validate against schema
  const schemaCheck = validateGraphSchema(result.graph);
  if (!schemaCheck.valid) {
    console.log("Schema validation errors:");
    for (const err of schemaCheck.errors) console.log(`  - ${err}`);
  }

  // Show nodes
  console.log();
  console.log("Nodes:");
  for (const node of result.graph.nodes) {
    const deps = node.dependencies.length > 0 ? ` (after: ${node.dependencies.join(", ")})` : "";
    console.log(`  ${node.id}: ${node.title}${deps}`);
  }

  if (!result.valid) {
    console.log();
    console.log("Errors:");
    for (const err of result.errors) console.log(`  - ${err}`);
    console.log("Used fallback single-node graph.");
  }
  process.exit(0);
}

// --- alix graph run --- execute a planned graph ---
if (command === "graph" && args[0] === "run") {
  const graphId = args[1];
  if (!graphId) { console.error("Usage: alix graph run <graphId>"); process.exit(1); }
  const cwd = process.cwd();
  const { GraphExecutor } = await import("./kernel/graph-executor.js");
  const executor = new GraphExecutor(cwd);
  console.log(`Executing graph: ${graphId}`);
  console.log();
  const result = await executor.execute(graphId);
  for (const nr of result.results) {
    const icon = nr.status === "done" ? "✓" : nr.status === "failed" ? "✗" : "○";
    console.log(`  ${icon} ${nr.title} (${nr.durationMs}ms)`);
    if (nr.reason) console.log(`     reason: ${nr.reason}`);
  }
  console.log();
  console.log(`Graph: ${result.graphStatus} — ${result.completedNodes}/${result.nodeCount} nodes`);
  process.exit(0);
}

// --- alix graph rerun --- rerun a failed node ---
if (command === "graph" && args[0] === "rerun") {
  const graphId = args[1];
  const nodeIdx = args.indexOf("--node");
  const nodeId = nodeIdx >= 0 ? args[nodeIdx + 1] : undefined;
  const force = args.includes("--force");

  if (!graphId || !nodeId) {
    console.error("Usage: alix graph rerun <graphId> --node <nodeId> [--force]");
    process.exit(1);
  }

  const cwd = process.cwd();
  const { GraphExecutor } = await import("./kernel/graph-executor.js");
  const executor = new GraphExecutor(cwd);

  try {
    const result = await executor.rerunNode(graphId, nodeId, { force });
    const icon = result.status === "done" ? "✓" : "✗";
    console.log(`  ${icon} ${result.title} (${result.durationMs}ms)`);
    if (result.reason) console.log(`     reason: ${result.reason}`);
    process.exit(result.status === "done" ? 0 : 1);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// --- alix graph list --- list saved graphs ---
if (command === "graph" && args[0] === "list") {
  const { readdir } = await import("node:fs/promises");
  const cwd = process.cwd();
  const graphsDir = join(cwd, ".alix", "graphs");
  if (!existsSync(graphsDir)) { console.log("No graphs found."); process.exit(0); }
  const files = await readdir(graphsDir);
  const jsonFiles = files.filter(f => f.endsWith(".json") && !f.includes(".raw") && !f.includes(".validation"));
  if (jsonFiles.length === 0) { console.log("No graphs found."); process.exit(0); }
  console.log("Saved graphs:");
  for (const f of jsonFiles.sort().reverse()) {
    const id = f.replace(/\.json$/, "");
    try {
      const graph = JSON.parse(await readFile(join(cwd, ".alix", "graphs", f), "utf-8"));
      console.log(`  ${id} — ${graph.nodes?.length ?? "?"} nodes, "${(graph.rootGoal || "").slice(0, 60)}"`);
    } catch { console.log(`  ${id} — (unreadable)`); }
  }
  process.exit(0);
}

// --- alix graph inspect --- show graph details ---
if (command === "graph" && args[0] === "inspect") {
  const graphId = args[1];
  if (!graphId) { console.error("Usage: alix graph inspect <graphId>"); process.exit(1); }
  const cwd = process.cwd();
  const { loadGraph, sortNodesByDependencies, normalizeNode } = await import("./kernel/graph-executor.js");
  try {
    const graph = await loadGraph(graphId, cwd);
    const nodes = graph.nodes;

    console.log(`Graph:     ${graph.id}`);
    console.log(`Goal:      ${graph.rootGoal}`);
    console.log(`Strategy:  ${graph.strategy}`);
    console.log(`Nodes:     ${nodes.length}`);
    console.log(`Status:    ${graph.status}`);
    console.log();

    for (const node of nodes) {
      const deps = node.dependencies.length > 0 ? ` (depends on: ${node.dependencies.join(", ")})` : "";
      console.log(`  ${node.id}: ${node.title}${deps}`);
      console.log(`    Goal:       ${node.goal}`);
      console.log(`    Domain:     ${node.domain}`);
      console.log(`    Risk:       ${node.riskLevel}`);
      console.log(`    Status:     ${node.status}`);
      if (node.requiredCapabilities.length > 0) {
        console.log(`    Requires:   ${node.requiredCapabilities.join(", ")}`);
      }
    }

    // Check for linked reports
    try {
      const { existsSync } = await import("node:fs");
      const reportsDir = join(cwd, ".alix", "reports");
      if (existsSync(reportsDir)) {
        const { readdir, readFile } = await import("node:fs/promises");
        const reportDirs = await readdir(reportsDir);
        for (const rd of reportDirs) {
          const mp = join(reportsDir, rd, "run_manifest.json");
          if (existsSync(mp)) {
            const m = JSON.parse(await readFile(mp, "utf-8"));
            if (m.graphId === graphId) {
              console.log(`Report:     ${rd}`);
              console.log(`Artifacts:  .alix/reports/${rd}/`);
            }
          }
        }
      }
    } catch {}

    // Show run projection data
    try {
      const { buildGraphProjection } = await import("./kernel/graph-projection.js");
      const projection = await buildGraphProjection(graphId, cwd);
      if (projection.sessionIds.length > 0) {
        console.log();
        console.log("Run sessions:");
        for (const sid of projection.sessionIds) {
          console.log(`  ${sid}`);
        }
      }
      if (projection.reports.length > 0) {
        console.log();
        console.log("Reports:");
        for (const r of projection.reports) {
          console.log(`  ${r}`);
        }
      }
    } catch {}
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  process.exit(0);
}

// --- alix graph export --- export graph as mermaid or json ---
if (command === "graph" && args[0] === "export") {
  const graphId = args[1];
  const formatIdx = args.indexOf("--format");
  const format = formatIdx >= 0 && args[formatIdx + 1] ? args[formatIdx + 1] : "json";
  if (!graphId) { console.error("Usage: alix graph export <graphId> --format mermaid|json"); process.exit(1); }
  const cwd = process.cwd();
  const { loadGraph, sortNodesByDependencies, normalizeNode } = await import("./kernel/graph-executor.js");

  try {
    const graph = await loadGraph(graphId, cwd);
    const sorted = sortNodesByDependencies(graph.nodes.map(normalizeNode));

    if (format === "mermaid") {
      console.log("```mermaid");
      console.log("graph TD;");
      for (const node of sorted) {
        const safeId = node.id.replace(/[^a-zA-Z0-9]/g, "_");
        console.log(`    ${safeId}["${node.title.replace(/"/g, "'")}"];`);
        for (const dep of node.dependencies) {
          const depSafe = dep.replace(/[^a-zA-Z0-9]/g, "_");
          console.log(`    ${depSafe} --> ${safeId};`);
        }
      }
      // Nodes without dependencies start from root
      const roots = sorted.filter(n => n.dependencies.length === 0);
      if (roots.length > 0) {
        console.log("    root((Start))");
        for (const r of roots) {
          const safeId = r.id.replace(/[^a-zA-Z0-9]/g, "_");
          console.log(`    root --> ${safeId};`);
        }
      }
      console.log("```");
    } else {
      console.log(JSON.stringify(graph, null, 2));
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  process.exit(0);
}

// --- alix sop --- SOP management ---
if (command === "sop" && args[0] === "list") {
  const { listSops } = await import("./sop/sop-registry.js");
  const sops = listSops();
  if (sops.length === 0) { console.log("No SOPs registered."); process.exit(0); }
  for (const s of sops) {
    console.log(`  ${s.id.padEnd(30)} ${s.description}`);
  }
  process.exit(0);
}

if (command === "sop" && args[0] === "run") {
  const sopId = args[1];
  const topicIdx = args.indexOf("--topic");
  const planOnly = args.includes("--plan-only");

  // Collect topic words after --topic, stopping before any --flag
  let topic = "";
  if (topicIdx >= 0) {
    const topicWords: string[] = [];
    for (let i = topicIdx + 1; i < args.length; i++) {
      if (args[i].startsWith("--")) break;
      topicWords.push(args[i]);
    }
    topic = topicWords.join(" ");
  }

  // Reject bracket literals
  if (topic.includes("[") || topic.includes("]")) {
    console.error("Unexpected bracket syntax. Did you mean --plan-only instead of [--plan-only]?");
    process.exit(1);
  }

  if (!sopId) { console.error("Usage: alix sop run <sop-id> --topic \"<topic>\" [--plan-only]"); process.exit(1); }
  if (!topic) { console.error("Error: --topic is required"); process.exit(1); }

  const { getSop, listSops } = await import("./sop/sop-registry.js");
  const { getResearchDeepReportDef } = await import("./sop/research-deep-report.js");

  // Register built-in SOPs
  const deepReport = getResearchDeepReportDef();
  // Import triggers registration or register manually

  const sop = getSop(sopId);
  if (!sop) { console.error(`SOP not found: ${sopId}`); process.exit(1); }

  const result = sop.buildGraph({ topic });
  const { graph, reportId } = result as any;

  // Persist graph
  const { persistGraph } = await import("./kernel/graph-planner.js");
  const filePath = await persistGraph(graph, process.cwd());

  console.log(`SOP:        ${sopId}`);
  console.log(`Topic:      ${topic}`);
  console.log(`Graph:      ${graph.id}`);
  console.log(`Nodes:      ${graph.nodes.length}`);
  console.log(`Saved:      ${filePath}`);
  console.log();

  if (planOnly) {
    console.log("Plan-only mode. Graph saved — not executed.");
    process.exit(0);
  }

  // Execute graph
  const { GraphExecutor } = await import("./kernel/graph-executor.js");
  const executor = new GraphExecutor(process.cwd());
  console.log("Executing...");
  const execResult = await executor.execute(graph.id);
  for (const nr of execResult.results) {
    const icon = nr.status === "done" ? "✓" : "✗";
    console.log(`  ${icon} ${nr.title} (${nr.durationMs}ms)`);
  }
  console.log(`\nResult: ${execResult.graphStatus} — ${execResult.completedNodes}/${execResult.nodeCount} nodes`);

  // Write enriched manifest
  if (execResult.graphStatus === "completed") {
    const { writeReportArtifacts } = await import("./sop/artifact-writer.js");
    await writeReportArtifacts({
      cwd: process.cwd(),
      reportId,
      artifacts: {
        finalReport: `# ${topic}\n\nResearch report generated by ${sopId}.\n\nSee sources.json and claims.json for details.\n`,
        sources: [],
        claims: [],
        criticReview: "No critic review was generated in this run.\n",
      },
      graphId: graph.id,
      sopId,
      topic,
      nodeResults: execResult.results.map(nr => ({
        nodeId: nr.nodeId,
        title: nr.title,
        status: nr.status,
      })),
    });
    console.log(`Report:     .alix/reports/${reportId}/`);
    console.log(`  alix report show ${reportId}`);
    console.log(`  alix report open ${reportId}`);
  }
  process.exit(0);
}

if (command === "sop" && args[0] !== "list" && args[0] !== "run") {
  console.log("Usage: alix sop list | alix sop run <id> --topic \"<topic>\"");
  process.exit(0);
}
// --- alix report --- report artifact commands ---
if (command === "report") {
  const { runReportCommand } = await import("./cli/commands/report.js");
  await runReportCommand(args);
  process.exit(0);
}


if (command === "config" && args[0] === "set-key") {
  const providerId = await selectProvider();
  const provider = PROVIDERS.find((p) => p.id === providerId)!;
  console.log(`\nSetting API key for ${provider.name} (${provider.env})`);
  const key = await prompt(`API key (${provider.hint}): `);
  if (!key) {
    console.log("No key entered. Cancelled.");
    process.exit(0);
  }
  await setApiKey(providerId, key);
  // Inject into current process so the key works immediately
  process.env[provider.env] = key;
  console.log(`\nDone! ${provider.name} API key saved and loaded.`);
  process.exit(0);
}

if (command === "config" && args[0] === "set-default-model") {
  const providerId = await selectProvider();
  const provider = PROVIDERS.find((p) => p.id === providerId)!;

  let apiKey = process.env[provider.env] ?? (await getSavedApiKey(providerId));
  if (!apiKey) {
    console.log(`\nNo API key found for ${provider.name}.`);
    const key = await prompt(`Enter API key (${provider.hint}): `);
    if (!key) { console.log("Cancelled."); process.exit(0); }
    await setApiKey(providerId, key);
    apiKey = key;
    process.env[provider.env] = key;
  }

  console.log(`\nFetching available models for ${provider.name}...\n`);
  let models: ModelInfo[];
  try {
    models = await listModels(providerId, apiKey);
  } catch (err) {
    console.error(`Failed to fetch models: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  if (models.length === 0) {
    console.log("No models found.");
    process.exit(1);
  }

  // Show up to 50 models with token limits if available
  const MAX_SHOWN = 50;
  const shown = models.slice(0, MAX_SHOWN);
  for (let i = 0; i < shown.length; i++) {
    const m = shown[i];
    const tokens = m.maxInputTokens
      ? ` (in: ${(m.maxInputTokens / 1000).toFixed(0)}k)`
      : "";
    console.log(`  ${i + 1}. ${m.displayName}${tokens}`);
  }
  if (models.length > MAX_SHOWN) console.log(`  ... and ${models.length - MAX_SHOWN} more`);

  const answer = await prompt(`\nSelect model (1-${shown.length}, 0 to cancel): `);
  const num = parseInt(answer, 10);
  if (num === 0 || isNaN(num) || num > shown.length) {
    console.log("Cancelled.");
    process.exit(0);
  }

  const selected = shown[num - 1];

  // Save to project config (.alix/config.json) if inside a git repo,
  // otherwise user config (~/.config/alix/config.json)
  const projectConfigPath = join(process.cwd(), ".alix", "config.json");
  const userConfigDir = join(homedir(), ".config", "alix");
  const userConfigPath = join(userConfigDir, "config.json");
  const configPath = existsSync(join(process.cwd(), ".git")) ? projectConfigPath : userConfigPath;
  const isProjectConfig = configPath === projectConfigPath;

  await mkdir(isProjectConfig ? join(process.cwd(), ".alix") : userConfigDir, { recursive: true });
  let existing: Record<string, unknown> = {};
  try { existing = JSON.parse(await readFile(configPath, "utf8")); } catch { /* no config yet */ }

  const updated = {
    ...existing,
    model: { provider: providerId, name: selected.id },
  };
  await writeFile(configPath, JSON.stringify(updated, null, 2) + "\n");
  console.log(`\nDefault model set to "${selected.id}" for ${provider.name}.`);
  console.log(`Saved to ${configPath}`);
  process.exit(0);
}

if (command === "config" && args[0] === "set-tier") {
  const TIERS = ["thinking", "coding", "fast", "critic", "tiny", "image"] as const;
  let tierName: string = args[1];

  if (!tierName || !TIERS.includes(tierName as any)) {
    console.log("\nSelect a subagent tier to configure:");
    for (let i = 0; i < TIERS.length; i++) {
      const desc: Record<string, string> = {
        thinking: "Strategic reasoning, planning, complex logic",
        coding: "Code generation, tool execution, patches",
        fast: "Quick classification, routing, simple tasks",
        critic: "Verification, validation, hallucination checks",
        tiny: "Embeddings, reranking, memory compression",
        image: "Image generation, multimodal analysis",
      };
      console.log(`  ${i + 1}. ${TIERS[i]} - ${desc[TIERS[i]]}`);
    }
    const answer = await prompt(`\nSelect tier (1-${TIERS.length}, 0 to cancel): `);
    const num = parseInt(answer, 10);
    if (num === 0 || isNaN(num) || num > TIERS.length) { console.log("Cancelled."); process.exit(0); }
    tierName = TIERS[num - 1];
  }

  const providerId = await selectProvider();
  const provider = PROVIDERS.find((p) => p.id === providerId)!;

  let apiKey = process.env[provider.env] ?? (await getSavedApiKey(providerId));
  if (!apiKey) {
    console.log(`\nNo API key found for ${provider.name}.`);
    const key = await prompt(`Enter API key (${provider.hint}): `);
    if (!key) { console.log("Cancelled."); process.exit(0); }
    await setApiKey(providerId, key);
    apiKey = key;
    process.env[provider.env] = key;
  }

  console.log(`\nFetching available models for ${provider.name}...\n`);
  let models: ModelInfo[];
  try {
    models = await listModels(providerId, apiKey);
  } catch (err) {
    console.error(`Failed to fetch models: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
  if (models.length === 0) { console.log("No models found."); process.exit(1); }

  const MAX_SHOWN = 50;
  const shown = models.slice(0, MAX_SHOWN);
  for (let i = 0; i < shown.length; i++) {
    const m = shown[i];
    const tokens = m.maxInputTokens ? ` (in: ${(m.maxInputTokens / 1000).toFixed(0)}k)` : "";
    console.log(`  ${i + 1}. ${m.displayName}${tokens}`);
  }
  if (models.length > MAX_SHOWN) console.log(`  ... and ${models.length - MAX_SHOWN} more`);

  const answer = await prompt(`\nSelect model (1-${shown.length}, 0 to cancel): `);
  const num = parseInt(answer, 10);
  if (num === 0 || isNaN(num) || num > shown.length) { console.log("Cancelled."); process.exit(0); }
  const selected = shown[num - 1];

  const projectConfigPath = join(process.cwd(), ".alix", "config.json");
  const userConfigDir = join(homedir(), ".config", "alix");
  const userConfigPath = join(userConfigDir, "config.json");
  const configPath = existsSync(join(process.cwd(), ".git")) ? projectConfigPath : userConfigPath;
  const isProjectConfig = configPath === projectConfigPath;

  await mkdir(isProjectConfig ? join(process.cwd(), ".alix") : userConfigDir, { recursive: true });
  let existing: Record<string, unknown> = {};
  try { existing = JSON.parse(await readFile(configPath, "utf8")); } catch { /* no config yet */ }

  const subagents = (existing.subagents as Record<string, unknown>) ?? {};
  subagents[tierName] = { provider: providerId, name: selected.id };

  const updated = { ...existing, subagents: { ...(existing.subagents as any), ...subagents } };
  await writeFile(configPath, JSON.stringify(updated, null, 2) + "\n");
  console.log(`\nTier "${tierName}" set to ${providerId}/${selected.id}.`);
  console.log(`Saved to ${configPath}`);
  process.exit(0);
}

if (command === "config" && args[0] === "show") {
  console.log(JSON.stringify(await loadConfig(process.cwd()), null, 2));
  process.exit(0);
}

if (command === "run") {
  const { parseRunArgs } = await import("./cli/run-args.js");
  const { task, noStream, noPlan, sessionMode, resumeSessionId, planFilePath } = parseRunArgs(args);

  if (!task && !resumeSessionId) {
    console.error("Usage: alix run \"<task>\" [--no-stream] [--no-plan] [--mode=auto|ask|bypass] [--resume <session-id>] [--plan-file <path>]");
    process.exit(1);
  }
  try {
    const result = await runTask(process.cwd(), task, { streaming: noStream ? false : undefined, planMode: noPlan ? false : undefined, sessionMode, resumeSessionId, planFilePath });
    if (!result.streamed) {
      console.log(result.summary);
    }
    console.log(`Session: ${result.sessionId}`);
    if (result.reason === "rejected_scope_expansion") {
      process.exit(EXIT_CODES.REJECTED_SCOPE_EXPANSION);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof ApiError) {
      if (msg.includes("credit balance") || msg.includes("upgrade")) {
        console.error(`\n⚠️  API: Insufficient credits.\n    ${err.detail}\n\nFix: Add credits or switch providers:\n     alix config set-default-model openai gpt-4o`);
      } else if (msg.includes("invalid_request_error") || err.status === 401) {
        console.error(`\n⚠️  API: Authentication failed.\n    ${err.detail}\n\nFix: Check your API key.`);
      } else {
        console.error(`\n⚠️  API error (${err.status}):\n    ${err.detail}`);
      }
    } else {
      console.error(`\n⚠️  ${msg}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

if (command === "tui") {
  const { runTui } = await import("./cli/commands/tui.js");
  await runTui({});
  process.exit(0);
}

// --- alix demo -- M0.9 demo path ---
if (command === "demo" && args[0] === "local") {
  const { runDemo } = await import("./cli/commands/demo.js");
  await runDemo();
  process.exit(0);
}

if (command === "serve") {
  const config = await loadConfig(process.cwd());
  if (!config.ui?.enabled) {
    console.error("UI inspector is not enabled. Set ui.enabled=true in your config.");
    process.exit(1);
  }
  const { startServer } = await import("./server/server.js");
  const server = await startServer(process.cwd(), config.ui.host, config.ui.port);
  console.log(`ALiX inspector running at ${server.url}`);
  await new Promise(() => undefined);
}

if (command === "mcp") {
  const config = await loadConfig(process.cwd());
  const { McpManager } = await import("./mcp/manager.js");
  const mcpManager = new McpManager(config);
  await mcpManager.initialize();

  try {
    const subcommand = args[0] ?? "";
    switch (subcommand) {
      case "list": {
        const servers = mcpManager.listServers();
        const tools = mcpManager.listTools();
        if (servers.length === 0) {
          console.log("No MCP servers connected.");
          console.log("Add servers in .alix/config.json under 'mcpServers'.");
        } else {
          console.log(`Connected servers: ${servers.length}`);
          for (const server of servers) {
            const serverTools = tools.filter((t) => t.serverName === server);
            console.log(`  ${server}: ${serverTools.length} tools`);
            for (const tool of serverTools) {
              console.log(`    - ${tool.fullName}${tool.description ? ` — ${tool.description}` : ""}`);
            }
          }
        }
        break;
      }
      case "add": {
        if (!args[1]) {
          console.log("Interactive MCP server setup.\n");
        }
        const name = args[1] ?? await prompt("Server name (e.g. fetch): ");
        const type = (args[2] ?? await prompt("Type [stdio|http|websocket] (default: stdio): ")) || "stdio";
        if (!name) { console.error("Cancelled."); process.exit(0); }

        const serverConfig: Record<string, unknown> = { name, type };

        if (type === "stdio") {
          const command = await prompt("Command (e.g. uvx or npx): ");
          const rawArgs = await prompt("Args (e.g. mcp-server-fetch, comma-separated): ");
          const argsList = rawArgs ? rawArgs.split(",").map((s: string) => s.trim()) : [];
          Object.assign(serverConfig, { command, args: argsList });
        } else if (type === "http" || type === "websocket") {
          const url = await prompt("URL (e.g. http://localhost:3000): ");
          Object.assign(serverConfig, { url });
        }

        const apiKey = await prompt("API key (optional, skip if none): ");
        if (apiKey.trim()) {
          const envKey = `${name.toUpperCase().replace(/-/g, "_")}_API_KEY`;
          Object.assign(serverConfig, { env: { [envKey]: apiKey.trim() } });
        }

        console.log(`\nServer config:`);
        console.log(JSON.stringify(serverConfig, null, 2));

        const confirm = await prompt("\nAdd to project config (.alix/config.json)? [y/N]: ");
        if (confirm.toLowerCase() !== "y") { console.log("Cancelled."); process.exit(0); }

        const projectConfigPath = join(process.cwd(), ".alix", "config.json");
        await mkdir(join(process.cwd(), ".alix"), { recursive: true });
        let existing: Record<string, unknown> = {};
        try { existing = JSON.parse(await readFile(projectConfigPath, "utf8")); } catch { /* no config yet */ }

        const servers: unknown[] = existing.mcpServers ? [...(existing.mcpServers as unknown[])] : [];
        servers.push(serverConfig);
        const updated = { ...existing, mcpServers: servers };
        await writeFile(projectConfigPath, JSON.stringify(updated, null, 2) + "\n");
        console.log(`Added '${name}' to .alix/config.json`);
        break;
      }
      case "remove": {
        const name = args[1];
        if (!name) {
          console.error("Usage: alix mcp remove <name>");
          process.exit(1);
        }
        await mcpManager.closeServer(name);
        console.log(`Server '${name}' disconnected.`);
        break;
      }
      case "discover": {
        const packageName = args[1];
        if (!packageName) {
          console.error("Usage: alix mcp discover <npm-package-name>");
          process.exit(1);
        }
        try {
          const info = await mcpManager.discoverServer(packageName);
          console.log(`Server: ${info.name} v${info.version}`);
          console.log(`Tools: ${info.toolCount}`);
          for (const t of info.toolNames) {
            console.log(`  - ${t}`);
          }

          const confirm = await prompt("\nAdd to project config (.alix/config.json)? [y/N]: ");
          if (confirm.toLowerCase() !== "y") {
            console.log("Cancelled.");
            process.exit(0);
          }

          const projectConfigPath = join(process.cwd(), ".alix", "config.json");
          await mkdir(join(process.cwd(), ".alix"), { recursive: true });
          let existing: Record<string, unknown> = {};
          try { existing = JSON.parse(await readFile(projectConfigPath, "utf8")); } catch { /* no config yet */ }

          const servers: unknown[] = existing.mcpServers ? [...(existing.mcpServers as unknown[])] : [];
          servers.push({ name: info.name, type: "stdio", command: "uvx", args: [packageName] });
          const updated = { ...existing, mcpServers: servers };
          await writeFile(projectConfigPath, JSON.stringify(updated, null, 2) + "\n");
          console.log(`Added '${info.name}' to .alix/config.json`);
        } catch (err) {
          console.error(`Discovery failed: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
        break;
      }
      case "test": {
        const name = args[1];
        if (!name) {
          console.error("Usage: alix mcp test <name>");
          process.exit(1);
        }
        if (!mcpManager.listServers().includes(name)) {
          console.error(`Server '${name}' not found. Run 'alix mcp list' to see connected servers.`);
          process.exit(1);
        }
        const client = mcpManager.getClient(name);
        const tools = mcpManager.listTools().filter((t) => t.serverName === name);
        console.log(`Server: ${name}`);
        if (client?.serverInfo) {
          console.log(`Version: ${client.serverInfo.version}`);
        }
        console.log(`Tools: ${tools.length}`);
        for (const tool of tools) {
          console.log(`  - ${tool.fullName}${tool.description ? ` — ${tool.description}` : ""}`);
        }
        break;
      }
      default: {
        console.error(`Unknown mcp subcommand: '${subcommand}'`);
        console.error("Available: list, add, remove, discover, test");
        process.exit(1);
      }
    }
  } finally {
    await mcpManager.closeAll().catch(() => {});
  }
  process.exit(0);
}

if (command === "extension") {
  const { homedir } = await import("node:os");
  const { join: pjoin } = await import("node:path");
  const { ExtensionRegistry } = await import("./extensions/registry.js");

  const storePath = pjoin(homedir(), ".alix", "extensions");
  const registry = new ExtensionRegistry(storePath);

  const sub = args[0];
  if (sub === "list") {
    const typeFilter = args[1] as any;
    const all = registry.list(typeFilter ? { type: typeFilter } : undefined);
    console.log(`Installed extensions (${all.length}):`);
    for (const ext of all) {
      const m = ext.manifest;
      const core = m.is_core ? " [core]" : "";
      const trigger = (m as any).trigger ? ` trigger:${(m as any).trigger}` : "";
      console.log(`  ${m.type}/${m.name}${core} — ${m.description} (v${m.version})${trigger}`);
    }
  } else if (sub === "install") {
    const src = args[1];
    if (!src) { console.error("Usage: alix extension install <path>"); process.exit(1); }
    const installed = await registry.install(src);
    if (installed) {
      console.log(`Installed: ${installed.manifest.type}/${installed.manifest.name}`);
    } else {
      console.error("Install failed: no EXTENSION.yaml found or manifest invalid");
      process.exit(1);
    }
  } else if (sub === "uninstall") {
    const id = args[1];
    if (!id) { console.error("Usage: alix extension uninstall <type>/<name>"); process.exit(1); }
    const removed = await registry.uninstall(id);
    if (removed) {
      console.log(`Uninstalled: ${id}`);
    } else {
      console.log(`Failed: ${id} not found or is a core extension`);
      process.exit(1);
    }
  } else if (sub === "search") {
    const query = (args[1] ?? "").toLowerCase();
    if (!query) { console.error("Usage: alix extension search <query>"); process.exit(1); }
    const all = registry.list();
    const matches = all.filter(e =>
      e.manifest.name.toLowerCase().includes(query) ||
      e.manifest.description.toLowerCase().includes(query) ||
      e.manifest.tags?.some(t => t.toLowerCase().includes(query))
    );
    console.log(`Search results for "${query}":`);
    if (matches.length === 0) { console.log("  (no matches)"); }
    for (const ext of matches) {
      console.log(`  ${ext.manifest.type}/${ext.manifest.name} — ${ext.manifest.description}`);
    }
  } else {
    console.log("Usage: alix extension [list|install|uninstall|search]");
    console.log("  list [type]    — list installed extensions, optionally filter by type");
    console.log("  install <path> — install extension from a directory");
    console.log("  uninstall <id> — uninstall by id (e.g. skill/my-skill)");
    console.log("  search <query> — search by name, description, or tag");
  }
  process.exit(0);
}

// --- alix agent <role> "prompt" --- runs subagent in same process (no recursion)
const agentRole = process.argv[3];
if (command === "agent" && agentRole) {
  // Separate flags (--flag) from prompt words after position 3
  const restArgs = process.argv.slice(4);
  const promptWords: string[] = [];
  const extraArgs: string[] = [];
  for (let i = 0; i < restArgs.length; i++) {
    if (restArgs[i].startsWith("--") && !restArgs[i].startsWith("--prompt")) {
      // Flag arg; collect it and its value (if next arg isn't a flag)
      extraArgs.push(restArgs[i]);
      if (i + 1 < restArgs.length && !restArgs[i + 1].startsWith("--")) {
        extraArgs.push(restArgs[++i]);
      }
    } else {
      promptWords.push(restArgs[i]);
    }
  }
  const prompt = promptWords.join(" ");
  if (!prompt) { console.error("Usage: alix agent <role> <prompt>"); process.exit(1); }
  const config = await loadConfig(process.cwd());
  const provider = config.model.provider;
  const model = config.model.name;
  const { SubagentCLI } = await import("./agents/subagent-cli.js");
  await SubagentCLI.main([
    "--subagent", agentRole,
    "--task-id", crypto.randomUUID(),
    "--prompt", prompt,
    "--mode", "read_only",
    "--session-id", `cli-${Date.now()}`,
    "--provider", provider,
    "--model", model,
    "--output", "text",
    ...extraArgs,
  ]);
  // SubagentCLI.main() exits the process itself — if we reach here, something went wrong
  process.exit(1);
}

// --- alix run --subagent <role> --- subagent process entry point (called by parent) ---
// Contract: args[1]=role, args[2]=task-id, args[3]=prompt, args[4]=mode, args[5]=session-id
// args[6..n] = extra flags (e.g. --model, --owned-paths)
if (command === "run" && args[0] === "--subagent") {
  const { SubagentCLI } = await import("./agents/subagent-cli.js");
  const extraArgs = process.argv.slice(7);
  const subagentArgs = ["--subagent", args[1],
    "--task-id", args[2] ?? crypto.randomUUID(),
    "--prompt", args[3] ?? "",
    "--mode", args[4] ?? "read_only",
    "--session-id", args[5] ?? `cli-${Date.now()}`,
    ...extraArgs,
  ];
  await SubagentCLI.main(subagentArgs);
  process.exit(1);
}

// --- alix metrics --- m09 metrics display command ---
if (command === "metrics") {
  const { readSessionEvents } = await import("./inspector/session-reader.js");
  const sessionsDir = join(process.cwd(), ".alix", "sessions");
  const { readdir, stat } = await import("node:fs/promises");

  // Support --session <id>
  const sessionIdx = args.indexOf("--session");
  const sessionArg = sessionIdx >= 0 && args[sessionIdx + 1] ? args[sessionIdx + 1] : null;
  let targetSession: string;

  if (sessionArg) {
    targetSession = sessionArg;
  } else {
    // Find newest by mtime
    const entries = await readdir(sessionsDir, { withFileTypes: true });
    const dirs = (await Promise.all(
      entries.filter(d => d.isDirectory()).map(async d => {
        const p = join(sessionsDir, d.name);
        const s = await stat(p);
        return { name: d.name, mtimeMs: s.mtimeMs };
      })
    )).sort((a, b) => b.mtimeMs - a.mtimeMs);
    if (dirs.length === 0) { console.log("No sessions found."); process.exit(0); }
    targetSession = dirs[0].name;
  }

  const events = await readSessionEvents(process.cwd(), targetSession);
  const metricEvents = events.filter((e: any) => e.type === "m09.metric");
  if (metricEvents.length === 0) { console.log(`No metrics for session ${targetSession}.`); process.exit(0); }
  console.log(`Session: ${targetSession}`);
  console.log();

  const isRaw = args.includes("--raw");

  if (isRaw) {
    // Raw mode: one line per event
    for (const ev of metricEvents) {
      const p = ev.payload as any;
      console.log(`  ${p.name}: ${p.value}${p.labels ? ` ${JSON.stringify(p.labels)}` : ""}`);
    }
  } else {
    // Summary mode: group by name
    const counters: Record<string, number> = {};
    const timers: Record<string, number[]> = {};
    for (const ev of metricEvents) {
      const p = ev.payload as any;
      if (p.type === "timer") {
        if (!timers[p.name]) timers[p.name] = [];
        timers[p.name].push(p.value);
      } else {
        counters[p.name] = (counters[p.name] ?? 0) + p.value;
      }
    }
    if (Object.keys(counters).length > 0) {
      console.log("Counters:");
      for (const [name, total] of Object.entries(counters).sort()) {
        console.log(`  ${name}: ${total}`);
      }
      console.log();
    }
    if (Object.keys(timers).length > 0) {
      console.log("Timers:");
      for (const [name, values] of Object.entries(timers).sort()) {
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        console.log(`  ${name}: ${Math.round(avg)}ms (avg, ${values.length} samples)`);
      }
      console.log();
    }
    console.log(`Raw view: alix metrics --session ${targetSession} --raw`);
  }
  process.exit(0);
}

// --- alix db --- database management ---
if (command === "db") {
  const { DatabaseManager } = await import("./db/manager.js");
  const db = new DatabaseManager();

  if (args[0] === "migrate") {
    db.open();
    db.migrateKernel();
    const health = db.health();
    console.log(`Migrated. Tables: ${health.tables.length}`);
    db.close();
    process.exit(0);
  }

  if (args[0] === "doctor") {
    db.open();
    const health = db.health();
    if (health.ok) {
      console.log("Database: healthy");
      console.log(`Tables (${health.tables.length}): ${health.tables.join(", ")}`);
    } else {
      console.error(`Database: unhealthy — ${health.error}`);
      process.exit(1);
    }
    db.close();
    process.exit(0);
  }

  console.error("Usage: alix db migrate | alix db doctor");
  process.exit(1);
}

// --- alix memory --- memory management commands ---
if (command === "memory") {
  const memoryDir = resolve(process.cwd(), ".alix/memory");
  const { MemoryStore } = await import("./utils/memory/store.js");
  const sub = args[0];

  if (sub === "list") {
    const queryIdx = args.indexOf("--query");
    const query = queryIdx !== -1 ? args.slice(queryIdx + 1).join(" ") : args.slice(1).join(" ");
    const store = new MemoryStore(memoryDir);
    await store.init();
    const results = await store.find(query, 20);
    if (results.length === 0) {
      console.log("No memory entries found.");
    } else {
      for (const entry of results) {
        console.log(`[${entry.type}] ${entry.name} (confidence: ${entry.confidence})`);
        console.log(`  ${entry.content.slice(0, 100)}${entry.content.length > 100 ? "..." : ""}`);
        console.log();
      }
    }
  } else if (sub === "add") {
    const nameIdx = args.indexOf("--name");
    const typeIdx = args.indexOf("--type");
    const contentIdx = args.indexOf("--content");
    const descIdx = args.indexOf("--description");

    const name = nameIdx !== -1 ? args[nameIdx + 1] : null;
    const type = typeIdx !== -1 ? args[typeIdx + 1] : "project";
    const content = contentIdx !== -1 ? args[contentIdx + 1] : null;
    const description = descIdx !== -1 ? args[descIdx + 1] ?? "" : "";

    if (!name || !content) {
      console.error("Usage: alix memory add --name <name> --content <content> [--type <type>] [--description <desc>]");
      process.exit(1);
    }
    if (!MEMORY_TYPES.has(type as MemoryType)) {
      console.error("Invalid memory type. Expected one of: user, project, feedback, reference.");
      process.exit(1);
    }

    const store = new MemoryStore(memoryDir);
    await store.init();
    await store.save({
      name,
      description,
      type: type as MemoryType,
      content,
      confidence: 0.7,
      confirmations: 1,
    });
    await store.buildIndex();
    console.log("Memory entry saved.");
  } else if (sub === "search") {
    const query = args.slice(1).join(" ");
    if (!query) {
      console.error("Usage: alix memory search <query>");
      process.exit(1);
    }
    const store = new MemoryStore(memoryDir);
    await store.init();
    const results = await store.find(query, 10);
    console.log(`Found ${results.length} entries:`);
    for (const entry of results) {
      console.log(`  [${entry.type}] ${entry.name} (confidence: ${entry.confidence})`);
    }
  } else if (sub === "stats") {
    const { readdir } = await import("node:fs/promises");
    const dirs: MemoryType[] = ["user", "project", "feedback", "reference"];
    for (const dir of dirs) {
      const files = await readdir(join(memoryDir, dir)).catch(() => []);
      console.log(`${dir}: ${files.length} entries`);
    }
  } else {
    console.log("Usage: alix memory [list|add|search|stats]");
    console.log("  list [--query <text>]  - List memory entries, optionally filter by query");
    console.log("  add --name <n> --content <c> [--type <t>] [--description <d>] - Add a memory entry");
    console.log("  search <query>         - Search memory entries");
    console.log("  stats                  - Show memory statistics");
  }
  process.exit(0);
}

// --- alix session --- session management commands ---
if (command === "session") {
  const { listSessions, sessionInfo } = await import("./session/resume.js");

  if (args[0] === "list") {
    const sessions = await listSessions(process.cwd());
    if (sessions.length === 0) {
      console.log("No sessions found.");
    } else {
      console.log(`${"ID".padEnd(38)} ${"Task".padEnd(50)} ${"Status".padEnd(14)} ${"Iters".padEnd(6)} Date`);
      console.log("-".repeat(120));
      for (const s of sessions) {
        const date = s.createdAt ? new Date(s.createdAt).toLocaleDateString() : "";
        console.log(`${s.sessionId.padEnd(38)} ${s.task.slice(0, 48).padEnd(50)} ${s.status.padEnd(14)} ${String(s.iterations).padEnd(6)} ${date}`);
      }
    }
    process.exit(0);
  }

  if (args[0] === "show" && args[1]) {
    const info = await sessionInfo(process.cwd(), args[1]);
    if (!info) {
      console.error(`Session not found: ${args[1]}`);
      process.exit(1);
    }
    console.log(`Session:    ${info.sessionId}`);
    console.log(`Task:       ${info.task}`);
    console.log(`Status:     ${info.status}`);
    console.log(`Iterations: ${info.iterations}`);
    console.log(`Repairs:    ${info.repairs}`);
    console.log(`File changes: ${info.fileChanges}`);
    console.log(`Shell cmds: ${info.shellCommands}`);
    console.log(`Created:    ${info.createdAt ? new Date(info.createdAt).toLocaleString() : "unknown"}`);
    console.log(`Updated:    ${info.updatedAt ? new Date(info.updatedAt).toLocaleString() : "unknown"}`);
    process.exit(0);
  }

  if (args[0] === "show" && !args[1]) {
    console.error("Usage: alix session show <session-id>");
    process.exit(1);
  }

  console.log("Usage: alix session [list|show <id>]");
  console.log("  list             - List all sessions (newest first)");
  console.log("  show <id>        - Show session details");
  process.exit(0);
}

function parseChatArgs(args: string[]): ChatOptions {
  const opts: ChatOptions = {};
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "--resume" || arg === "-r") {
      opts.resume = true;
      i++;
    } else if (arg === "--list" || arg === "-l") {
      opts.list = true;
      i++;
    } else if (arg === "--delete" || arg === "-d") {
      opts.delete = args[++i];
      i++;
    } else if (!arg.startsWith("-")) {
      opts.sessionId = arg;
      i++;
    } else {
      i++;
    }
  }
  return opts;
}

if (command === "chat") {
  await runChat(parseChatArgs(args));
  process.exit(0);
}

if (command === "plan") {
  const { runPlan } = await import("./cli/commands/plan.js");
  if (args[0] === "--list" || args[0] === "-l") {
    await runPlan({ task: "", list: true });
  } else {
    const task = args.join(" ").replace(/^["']|["']$/g, "");
    await runPlan({ task });
  }
  process.exit(0);
}

if (command === "review") {
  const { runReview } = await import("./cli/commands/review.js");
  const planId = args[0];
  if (!planId) { console.error("Usage: alix review <plan-id>"); process.exit(1); }
  await runReview({ planId });
  process.exit(0);
}

if (command === "apply") {
  const { runApply } = await import("./cli/commands/apply.js");
  const planId = args[0];
  if (!planId) { console.error("Usage: alix apply <plan-id>"); process.exit(1); }
  await runApply({ planId });
  process.exit(0);
}

if (command === "skills") {
	  const { runInstall } = await import("./cli/commands/skills/install.js");
	  await runInstall({
	    available: args.includes("--available"),
	    list: args.includes("--list"),
	    all: args.includes("--all"),
	    name: args.find(a => !a.startsWith("--")),
	  });
	  process.exit(0);
	}

if (command === "research") {
  const { research } = await import("./cli/commands/research.js");
  await research(args);
  process.exit(0);
}

console.error(`Unknown command: ${command}`);
process.exit(1);
