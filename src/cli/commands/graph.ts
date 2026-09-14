/**
 * `alix graph` subcommands — extracted from `src/cli.ts` (#717 step 6).
 * Bodies moved verbatim; each handler terminates via `process.exit`.
 */

import { existsSync } from "node:fs";
import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../../config/loader.js";
import { resolveModelConfig } from "../../config/model-resolver.js";
import "../../index.js";

export async function handleGraphPlan(args: string[]): Promise<void> {
  const task = args.slice(1).filter(a => a !== "--debug").join(" ");
  if (!task) {
    console.error("Usage: alix graph plan \"<task>\"");
    process.exit(1);
  }
  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  const sessionId = `plan_${Date.now()}`;
  const { GraphPlanner, persistGraph, validateGraphSchema } = await import("../../kernel/graph-planner.js");
  const { createWorkflowRun } = await import("../../kernel/workflow-run.js");
  const { EventLog } = await import("../../events/event-log.js");

  // Create a minimal workflow run for planning
  const sessionDir = join(cwd, ".alix", "sessions", sessionId);
  await mkdir(sessionDir, { recursive: true });
  const planLog = new EventLog(sessionDir);
  await planLog.init();

  const wfRun = createWorkflowRun(sessionId, task);
  const resolved = resolveModelConfig(config);
  const planner = new GraphPlanner({
    modelName: resolved.name,
    modelEndpoint: resolved.provider === "ollama"
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

export async function handleGraphRun(args: string[]): Promise<void> {
  const graphId = args[1];
  if (!graphId) { console.error("Usage: alix graph run <graphId>"); process.exit(1); }
  const cwd = process.cwd();
  const { GraphExecutor } = await import("../../kernel/graph-executor.js");
  const { loadCardRegistry } = await import("../../registry/card-loader.js");
  const { PolicyGate } = await import("../../policy/policy-gate.js");
  const { ApprovalStore } = await import("../../approvals/approval-store.js");
  const config = await loadConfig(cwd);
  const registry = await loadCardRegistry(cwd);
  const approvalStore = new ApprovalStore(cwd);
  await approvalStore.load();
  const enforce = args.includes("--enforce-capabilities");
  const executor = new GraphExecutor(cwd, { registry, enforceCapabilities: enforce, policyGate: new PolicyGate(config, { approvalStore }), config, approvalStore });
  console.log(`Executing graph: ${graphId}`);
  if (enforce) console.log("  (capability enforcement enabled)");
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

export async function handleGraphRerun(args: string[]): Promise<void> {
  const graphId = args[1];
  const nodeIdx = args.indexOf("--node");
  const nodeId = nodeIdx >= 0 ? args[nodeIdx + 1] : undefined;
  const force = args.includes("--force");

  if (!graphId || !nodeId) {
    console.error("Usage: alix graph rerun <graphId> --node <nodeId> [--force]");
    process.exit(1);
  }

  const cwd = process.cwd();
  const { GraphExecutor } = await import("../../kernel/graph-executor.js");
  const { loadCardRegistry } = await import("../../registry/card-loader.js");
  const { PolicyGate } = await import("../../policy/policy-gate.js");
  const { ApprovalStore } = await import("../../approvals/approval-store.js");
  const config = await loadConfig(cwd);
  const registry = await loadCardRegistry(cwd);
  const approvalStore = new ApprovalStore(cwd);
  await approvalStore.load();
  const executor = new GraphExecutor(cwd, { registry, policyGate: new PolicyGate(config, { approvalStore }), config, approvalStore });

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

export async function handleGraphContinue(args: string[]): Promise<void> {
  const graphId = args[1];
  if (!graphId) { console.error("Usage: alix graph continue <graphId>"); process.exit(1); }
  const cwd = process.cwd();
  const { loadGraph, GraphExecutor } = await import("../../kernel/graph-executor.js");
  const { loadCardRegistry } = await import("../../registry/card-loader.js");
  const { PolicyGate } = await import("../../policy/policy-gate.js");
  const { ApprovalStore } = await import("../../approvals/approval-store.js");

  try {
    const graph = await loadGraph(graphId, cwd);
    const config = await loadConfig(cwd);
    const registry = await loadCardRegistry(cwd);
    const approvalStore = new ApprovalStore(cwd);
    await approvalStore.load();
    const policyGate = new PolicyGate(config, { approvalStore });

    // Find first blocked/failed node
    const blockedNode = graph.nodes.find((n: any) =>
      n.status === "failed" || n.status === "blocked"
    );
    if (!blockedNode) {
      console.log("No blocked or failed nodes found. Nothing to continue.");
      process.exit(0);
    }

    const caps = blockedNode.requiredCapabilities ?? [];
    if (caps.length === 0) {
      console.log(`Node ${blockedNode.id} has no required capabilities. Use rerun instead:`);
      console.log(`  alix graph rerun ${graphId} --node ${blockedNode.id} --force`);
      process.exit(0);
    }

    // Check approval store for matching records
    const pending = approvalStore.findPending({
      graphId, nodeId: blockedNode.id, capability: caps[0],
    });
    if (pending) {
      console.log(`Node ${blockedNode.id} has a pending approval: ${pending.id}`);
      console.log(`  alix approvals approve ${pending.id}`);
      console.log(`  alix approvals deny ${pending.id}`);
      process.exit(0);
    }

    const resolved = approvalStore.findResolved({
      graphId, nodeId: blockedNode.id, capability: caps[0],
    });
    if (!resolved) {
      console.log(`No approval found for node ${blockedNode.id}.`);
      console.log(`  alix graph rerun ${graphId} --node ${blockedNode.id} --force`);
      process.exit(0);
    }

    if (resolved.status === "denied") {
      console.log(`Node ${blockedNode.id} was denied: ${resolved.decisionReason || "No reason given"}`);
      process.exit(1);
    }

    // Approved — rerun the graph
    console.log(`Approval ${resolved.id} is approved. Rerunning graph ${graphId}...`);
    const { AuditStore } = await import("../../audit/audit-store.js");
    const audit = new AuditStore(cwd);
    await audit.append({ action: "graph.continued", actor: "user", details: {
      graphId, approvalId: resolved?.id,
      reason: resolved?.decisionReason,
    }});
    console.log();
    const executor = new GraphExecutor(cwd, { registry, policyGate, config, approvalStore });
    const result = await executor.execute(graphId);
    for (const nr of result.results) {
      const icon = nr.status === "done" ? "✓" : nr.status === "failed" ? "✗" : "○";
      console.log(`  ${icon} ${nr.title} (${nr.durationMs}ms)`);
      if (nr.reason) console.log(`     reason: ${nr.reason}`);
    }
    console.log();
    console.log(`Graph: ${result.graphStatus} — ${result.completedNodes}/${result.nodeCount} nodes`);
    process.exit(0);
  } catch (err: any) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export async function handleGraphRuns(args: string[]): Promise<void> {
  const graphId = args[1];
  if (!graphId) { console.error("Usage: alix graph runs <graphId>"); process.exit(1); }
  const cwd = process.cwd();
  const { buildGraphProjection } = await import("../../kernel/graph-projection.js");
  try {
    const p = await buildGraphProjection(graphId, cwd);
    console.log(`Graph:     ${p.graphId}`);
    console.log(`Status:    ${p.status}`);
    console.log();
    if (p.sessionIds.length > 0) {
      console.log("Sessions:");
      for (const sid of p.sessionIds) console.log(`  ${sid}`);
      console.log();
    }
    if (p.attempts && p.attempts.length > 0) {
      console.log("Attempts:");
      for (const a of p.attempts) {
        const icon = a.status === "done" ? "✓" : "✗";
        const dur = a.durationMs ? `${a.durationMs}ms` : "?";
        console.log(`  #${a.attempt} ${a.nodeId} ${icon} ${dur}  ${a.startedAt || ""}`);
      }
      console.log();
    }
    if (p.reports.length > 0) {
      console.log("Reports:");
      for (const r of p.reports) console.log(`  ${r}`);
      console.log();
    }
    for (const node of p.nodes) {
      const icon = node.status === "done" ? "✓" : node.status === "failed" ? "✗" : "○";
      console.log(`  ${icon} ${node.title}: ${node.status}${node.sessionId ? ` (${node.sessionId})` : ""}`);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  process.exit(0);

}

export async function handleGraphPreflight(args: string[]): Promise<void> {
  const graphId = args[1];
  if (!graphId) { console.error("Usage: alix graph preflight <graphId>"); process.exit(1); }
  const cwd = process.cwd();
  const { loadGraph } = await import("../../kernel/graph-executor.js");
  const { loadCardRegistry } = await import("../../registry/card-loader.js");
  const { resolveCapabilities } = await import("../../registry/capability-resolver.js");
  try {
    const graph = await loadGraph(graphId, cwd);
    const registry = await loadCardRegistry(cwd);
    console.log("Graph: " + graphId + "\n");
    for (const node of graph.nodes) {
      console.log(node.title);
      if (!node.requiredCapabilities || node.requiredCapabilities.length === 0) {
        console.log("  Status: ok (no capabilities required)");
        console.log();
        continue;
      }
      const r = resolveCapabilities({
        requiredCapabilities: node.requiredCapabilities,
        domain: node.domain,
        executionProfile: (node as any).executionProfile,
        registry,
      });
      if (r.missingCapabilities.length > 0) {
        console.log("  Missing: " + r.missingCapabilities.join(", "));
        console.log("  Status: blocked");
      } else if (r.warnings.length > 0) {
        for (const w of r.warnings) console.log("  Warning: " + w);
        console.log("  Status: needs_approval");
      } else {
        console.log("  Status: ready");
      }
      if (r.agents.length > 0) console.log("  Agents: " + r.agents.map((a: any) => a.id).join(", "));
      if (r.tools.length > 0) console.log("  Tools: " + r.tools.map((t: any) => t.id).join(", "));
      console.log();
    }
  } catch (err: any) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  process.exit(0);
}

export async function handleGraphList(_args: string[]): Promise<void> {
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

export async function handleGraphInspect(args: string[]): Promise<void> {
  const graphId = args[1];
  if (!graphId) { console.error("Usage: alix graph inspect <graphId>"); process.exit(1); }
  const cwd = process.cwd();
  const { loadGraph } = await import("../../kernel/graph-executor.js");
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
      const { buildGraphProjection } = await import("../../kernel/graph-projection.js");
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

export async function handleGraphExport(args: string[]): Promise<void> {
  const graphId = args[1];
  const formatIdx = args.indexOf("--format");
  const format = formatIdx >= 0 && args[formatIdx + 1] ? args[formatIdx + 1] : "json";
  if (!graphId) { console.error("Usage: alix graph export <graphId> --format mermaid|json"); process.exit(1); }
  const cwd = process.cwd();
  const { loadGraph, sortNodesByDependencies, normalizeNode } = await import("../../kernel/graph-executor.js");

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

