/**
 * demo.ts -- M0.9 safe visible demo path.
 *
 * Runs a read-only task (repo summary via directory inspect)
 * and displays WorkflowRun ID, TaskNode ID, model route,
 * tool event, and PolicyDecision.
 */

import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { runTask } from "../../run.js";
import { loadConfig } from "../../config/loader.js";

export async function runDemo(): Promise<void> {
  const cwd = process.cwd();

  console.log("ALiX M0.9 Demo -- Local Read-Only Task");
  console.log("---------------------------------------");
  console.log();

  // Run a simple read-only task
  const task = "list the files in the current directory and summarize the project structure";

  // Generate a predictable session ID so demo runs are findable
  const sessionId = `demo_${Date.now()}`;
  const sessionDir = join(cwd, ".alix", "sessions", sessionId);
  await mkdir(sessionDir, { recursive: true });

  const config = await loadConfig(cwd);
  const { resolveContextLimit } = await import("../../config/context-limits.js");
  const contextInfo = await resolveContextLimit(config.model.provider, config.model.name, config.apiKeys);
  const { EventLog } = await import("../../events/event-log.js");
  const tuiLog = new EventLog(sessionDir);
  await tuiLog.init();

  console.log(`Task:       ${task}`);
  console.log(`Provider:   ${config.model.provider}`);
  console.log(`Model:      ${config.model.name}`);
  console.log(`Context:    ${(contextInfo.maxTokens ?? 0).toLocaleString()} tokens`);
  console.log();

  try {
    const startTime = Date.now();
    const result = await runTask(cwd, task, {
      streaming: true,
      sessionMode: "bypass",
      sharedSession: { sessionId, sessionDir, eventLog: tuiLog },
    });
    const duration = Date.now() - startTime;

    console.log();
    console.log("-- Results -----------------------------------------------");
    console.log(`Session:     ${result.sessionId}`);
    console.log(`Duration:    ${duration}ms`);

    if (result.summary) {
      console.log(`Summary:     ${result.summary.slice(0, 200)}`);
    }

    // Show kernel artifacts from event log
    const events = await tuiLog.readAll();
    const workflowEvents = events.filter(e => e.type === "workflow.created");
    const graphEvents = events.filter(e => e.type === "graph.created");
    const toolEvents = events.filter(e => e.type === "tool.requested");
    const policyEvents = events.filter(e => e.type === "policy.decision");
    const metricEvents = events.filter(e => e.type === "m09.metric");

    console.log();
    console.log("-- Kernel Artifacts --------------------------------------");
    if (workflowEvents.length > 0) {
      console.log(`WorkflowRun:  ${(workflowEvents[0].payload as any)?.workflowId ?? "?"}`);
    }
    if (graphEvents.length > 0) {
      console.log(`TaskGraph:    ${(graphEvents[0].payload as any)?.graphId ?? "?"}`);
    }
    console.log(`Model calls:  ${events.filter(e => e.type === "model.usage").length}`);
    console.log(`Tool calls:   ${toolEvents.length}`);
    console.log(`Policy decisions: ${policyEvents.length}`);
    console.log(`Metrics:      ${metricEvents.length}`);
    // Verify no mutations occurred in read-only demo
    const mutationTypes = new Set(["file.created", "file.deleted", "patch.applied", "patch.changed_files"]);
    const mutationEvents = events.filter(e => mutationTypes.has(e.type));
    console.log(`Mutations:    ${mutationEvents.length}`);
    console.log();
    if (mutationEvents.length > 0) {
      console.error("⚠️  Demo failed safety check: mutation events detected in read-only mode!");
      process.exit(1);
    }
    console.log("✓ No files were modified.");
  console.log();
  console.log("View metrics: alix metrics --session " + sessionId);
  } catch (err) {
    console.error(`Demo failed: ${err instanceof Error ? err.message : String(err)}`);
    console.log();
    console.log("Tip: Ensure Ollama is running with the model configured in .alix/config.json");
    process.exit(1);
  }
}
