/**
 * sop.ts — `alix sop` CLI dispatcher.
 *
 * Four subcommands:
 *   list   — List all registered SOPs
 *   show   — Show SOP details
 *   doctor — Validate all registered SOPs
 *   run    — Execute an SOP workflow
 *
 * Extracted from inline code in src/cli.ts.
 * @module
 */

import { loadConfig } from "../../config/loader.js";

export async function handleSopCommand(args: string[]): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case "list": {
      const { listSops } = await import("../../sop/sop-registry.js");
      const sops = listSops();
      if (sops.length === 0) { console.log("No SOPs registered."); process.exit(0); }
      console.log(`${"ID".padEnd(30)} ${"Nodes".padEnd(6)} Tags`);
      console.log("-".repeat(70));
      for (const s of sops) {
        const tags = s.manifest?.tags?.join(", ") || "";
        const nodes = s.manifest?.nodeCount?.toString() || "?";
        console.log(`  ${s.id.padEnd(30)} ${nodes.padEnd(6)} ${tags}`);
      }
      process.exit(0);
    }

    case "show": {
      const sopId = args[1];
      if (!sopId) { console.error("Usage: alix sop show <id>"); process.exit(1); }
      const { getSop } = await import("../../sop/sop-registry.js");
      const sop = getSop(sopId);
      if (!sop) { console.error(`SOP not found: ${sopId}`); process.exit(1); }
      console.log(`ID:          ${sop.id}`);
      console.log(`Name:        ${sop.name}`);
      console.log(`Description: ${sop.description}`);
      if (sop.manifest) {
        console.log(`Author:      ${sop.manifest.author || "—"}`);
        console.log(`Version:     ${sop.manifest.version || "—"}`);
        console.log(`Nodes:       ${sop.manifest.nodeCount || "?"}`);
        console.log(`Tags:        ${sop.manifest.tags?.join(", ") || "—"}`);
        console.log(`Capabilities: ${sop.manifest.requiredCapabilities?.join(", ") || "—"}`);
      }
      process.exit(0);
    }

    case "doctor": {
      const { listSops } = await import("../../sop/sop-registry.js");
      const sops = listSops();
      if (sops.length === 0) { console.log("No SOPs registered."); process.exit(0); }
      let failed = false;
      for (const s of sops) {
        const issues: string[] = [];
        if (!s.manifest) issues.push("no manifest");
        else {
          if (!s.manifest.version) issues.push("no version");
          if (!s.manifest.nodeCount || s.manifest.nodeCount !== s.buildGraph({}).graph.nodes.length) issues.push("nodeCount mismatch");
        }
        if (issues.length === 0) {
          console.log(`[✓] ${s.id}`);
        } else {
          console.log(`[⚠] ${s.id} — ${issues.join(", ")}`);
          failed = true;
        }
      }
      console.log(`\n${sops.length} SOPs, ${failed ? "some have issues" : "all healthy"}`);
      process.exit(failed ? 1 : 0);
    }

    case "run": {
      const sopId = args[1];
      const topicIdx = args.indexOf("--topic");
      const planOnly = args.includes("--plan-only");

      let topic = "";
      if (topicIdx >= 0) {
        const topicWords: string[] = [];
        for (let i = topicIdx + 1; i < args.length; i++) {
          if (args[i].startsWith("--")) break;
          topicWords.push(args[i]);
        }
        topic = topicWords.join(" ");
      }

      const inputs: Record<string, string> = {};
      const inputIdx = args.indexOf("--input");
      if (inputIdx >= 0) {
        for (let i = inputIdx + 1; i < args.length; i++) {
          if (args[i].startsWith("--")) break;
          const eq = args[i].indexOf("=");
          if (eq > 0) {
            inputs[args[i].slice(0, eq)] = args[i].slice(eq + 1);
          }
        }
      }
      const pathIdx = args.indexOf("--path");
      if (pathIdx >= 0 && args[pathIdx + 1] && !args[pathIdx + 1].startsWith("--")) {
        inputs.path = args[pathIdx + 1];
      }

      if (topic.includes("[") || topic.includes("]")) {
        console.error("Unexpected bracket syntax. Did you mean --plan-only instead of [--plan-only]?");
        process.exit(1);
      }

      if (!sopId) { console.error("Usage: alix sop run <id> --topic \"<topic>\" | --input key=value ..."); process.exit(1); }

      const sopCwd = process.cwd();
      const { getSop, listSops } = await import("../../sop/sop-registry.js");

      const sop = getSop(sopId);
      if (!sop) { console.error(`SOP not found: ${sopId}`); process.exit(1); }

      const buildInput: Record<string, unknown> = { ...inputs };
      if (topic) buildInput.topic = topic;

      const result = sop.buildGraph(buildInput);
      const graph = (result as any).graph;
      const reportId = (result as any).reportId ?? (result as any).reportDir ?? `report_${Date.now()}`;

      const { persistGraph } = await import("../../kernel/graph-planner.js");
      const filePath = await persistGraph(graph, process.cwd());

      console.log(`SOP:        ${sopId}`);
      if (topic) console.log(`Topic:      ${topic}`);
      if (Object.keys(inputs).length > 0) {
        for (const [k, v] of Object.entries(inputs)) console.log(`Input:      ${k}=${v}`);
      }
      console.log(`Graph:      ${graph.id}`);
      console.log(`Nodes:      ${graph.nodes.length}`);
      console.log(`Saved:      ${filePath}`);
      console.log();

      if (planOnly) {
        console.log("Plan-only mode. Graph saved — not executed.");
        process.exit(0);
      }

      const { GraphExecutor } = await import("../../kernel/graph-executor.js");
      const { loadCardRegistry } = await import("../../registry/card-loader.js");
      const { PolicyGate } = await import("../../policy/policy-gate.js");
      const { ApprovalStore } = await import("../../approvals/approval-store.js");
      const enforce = args.includes("--enforce-capabilities");
      const config = await loadConfig(sopCwd);
      const registry = await loadCardRegistry(sopCwd);
      const approvalStore = new ApprovalStore(sopCwd);
      await approvalStore.load();
      const executor = new GraphExecutor(sopCwd, { registry, enforceCapabilities: enforce, policyGate: new PolicyGate(config, { approvalStore }), config, approvalStore });
      console.log("Executing...");
      if (enforce) console.log("  (capability enforcement enabled)");
      const execResult = await executor.execute(graph.id);
      for (const nr of execResult.results) {
        const icon = nr.status === "done" ? "✓" : "✗";
        console.log(`  ${icon} ${nr.title} (${nr.durationMs}ms)`);
      }
      console.log(`\nResult: ${execResult.graphStatus} — ${execResult.completedNodes}/${execResult.nodeCount} nodes`);

      if (execResult.graphStatus === "completed") {
        const { writeReportArtifacts } = await import("../../sop/artifact-writer.js");
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
          nodeResults: execResult.results.map((nr: any) => ({
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

    default:
      console.log("Usage: alix sop list | alix sop show <id> | alix sop run <id> --topic \"<topic>\" | alix sop doctor");
      process.exit(0);
  }
}
