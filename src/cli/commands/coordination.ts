/**
 * coordination.ts — CLI commands for coordination runs.
 *
 * alix coordination run "<goal>"                — plan, schedule, run until idle
 * alix coordination run "<goal>" --daemon        — plan and persist (daemon hosts ticking)
 * alix coordination run "<goal>" --max-concurrency 2
 * alix coordination tick <run-id>               — one dispatch cycle (admin/debug)
 * alix coordination resume <run-id>             — reconcile + tick (recovery)
 * alix coordination status <run-id>             — print run state
 * alix coordination cancel <run-id>             — cancel a running coordination run
 */

import { loadConfig } from "../../config/loader.js";
import { CoordinationStore } from "../../kernel/coordination-store.js";
import { CoordinationPlanner } from "../../kernel/coordination-planner.js";
import { CoordinationScheduler } from "../../kernel/coordination-scheduler.js";
import { OwnershipRegistry } from "../../ownership/ownership-registry.js";
import { ExecutionAuthorization } from "../../runtime/execution-authorization.js";
import { PolicyGate } from "../../policy/policy-gate.js";
import { DefaultWorkerExecutor } from "../../kernel/worker-executor.js";
import { buildDefaultToolIndex } from "../../tools/tool-registry.js";

export async function handleCoordination(args: string[]): Promise<void> {
  const subcommand = args[0];
  if (!subcommand) {
    console.error("Usage: alix coordination <run|tick|resume|status|cancel> ...");
    process.exit(1);
  }

  switch (subcommand) {
    case "run": return handleRun(args.slice(1));
    case "tick": return handleTick(args.slice(1));
    case "resume": return handleResume(args.slice(1));
    case "status": return handleStatus(args.slice(1));
    case "results": return handleResults(args.slice(1));
    case "cancel": return handleCancel(args.slice(1));
    default:
      console.error(`Unknown coordination subcommand: ${subcommand}`);
      process.exit(1);
  }
}

async function handleRun(args: string[]): Promise<void> {
  const goal = args.find(a => !a.startsWith("--"));
  const daemonMode = args.includes("--daemon");
  const maxConcurrencyArg = args.find(a => a.startsWith("--max-concurrency="));
  const maxConcurrency = maxConcurrencyArg ? parseInt(maxConcurrencyArg.split("=")[1], 10) : undefined;

  if (!goal) {
    console.error("Usage: alix coordination run \"<goal>\" [--daemon] [--max-concurrency=N]");
    process.exit(1);
  }

  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  const store = new CoordinationStore(cwd);
  const toolRegistry = buildDefaultToolIndex().registry;

  const planner = new CoordinationPlanner(cwd, {}, { toolRegistry });
  const planResult = await planner.plan(goal, "alix", `coord_${Date.now()}`);

  if (!planResult.valid) {
    console.error(`Coordination plan failed: ${planResult.errors.join("; ")}`);
    console.error(`Run ID: ${planResult.run?.id ?? "none"} (diagnostic)`);
    process.exit(1);
  }

  console.log(`Coordination plan created: ${planResult.run!.id}`);
  console.log(`  Goal: ${goal}`);
  console.log(`  Workers: ${planResult.run!.workers.length}`);

  if (daemonMode) {
    console.log("  Mode: daemon (ticking handled by daemon process)");
    return;
  }

  // Foreground mode — run until idle
  const policyGate = new PolicyGate(config, { eventLog: undefined });
  const auth = new ExecutionAuthorization({ policyGate, toolRegistry });
  const registry = new OwnershipRegistry(cwd);

  const executor = new DefaultWorkerExecutor();
  const scheduler = new CoordinationScheduler(
    { cwd, daemonInstanceId: `cli-${process.pid}`, configProvider: async () => config, store, authorization: auth, ownershipRegistry: registry, executor },
    { maxConcurrency },
  );

  const result = await scheduler.runUntilIdle(planResult.run!.id);
  console.log(`\nCoordination run complete:`);
  console.log(`  Status: ${result.finalStatus}`);
  console.log(`  Stop reason: ${result.stopReason}`);
  console.log(`  Cycles: ${result.cycles}`);
  console.log(`  Dispatched: ${result.dispatched}`);
  console.log(`  Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
  if (result.finalStatus === "failed") process.exit(1);
}

async function handleTick(args: string[]): Promise<void> {
  const runId = args[0];
  if (!runId) { console.error("Usage: alix coordination tick <run-id>"); process.exit(1); }

  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  const store = new CoordinationStore(cwd);
  const toolRegistry = buildDefaultToolIndex().registry;
  const policyGate = new PolicyGate(config, { eventLog: undefined });
  const auth = new ExecutionAuthorization({ policyGate, toolRegistry });
  const registry = new OwnershipRegistry(cwd);
  const executor = new DefaultWorkerExecutor();

  const scheduler = new CoordinationScheduler(
    { cwd, daemonInstanceId: `cli-${process.pid}`, configProvider: async () => config, store, authorization: auth, ownershipRegistry: registry, executor },
  );

  const result = await scheduler.tick(runId);
  console.log(`Tick result for ${runId}:`);
  console.log(`  Ready: ${result.ready}`);
  console.log(`  Dispatched: ${result.dispatched.length}`);
  console.log(`  Awaiting approval: ${result.awaitingApproval.length}`);
  console.log(`  Denied: ${result.denied.length}`);
  console.log(`  Ownership conflicts: ${result.ownershipConflicts.length}`);
  console.log(`  Running: ${result.activeRunning}`);
  console.log(`  Run status: ${result.runStatus}`);
}

async function handleResume(args: string[]): Promise<void> {
  const runId = args[0];
  if (!runId) { console.error("Usage: alix coordination resume <run-id>"); process.exit(1); }

  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  const store = new CoordinationStore(cwd);
  const toolRegistry = buildDefaultToolIndex().registry;
  const policyGate = new PolicyGate(config, { eventLog: undefined });
  const auth = new ExecutionAuthorization({ policyGate, toolRegistry });
  const registry = new OwnershipRegistry(cwd);
  const executor = new DefaultWorkerExecutor();

  const scheduler = new CoordinationScheduler(
    { cwd, daemonInstanceId: `cli-${process.pid}`, configProvider: async () => config, store, authorization: auth, ownershipRegistry: registry, executor },
  );

  const recResult = await scheduler.reconcile(runId);
  console.log(`Reconciliation for ${runId}:`);
  console.log(`  Orphans recovered: ${recResult.orphaned.length}`);
  console.log(`  Dependency blocks: ${recResult.dependencyBlocked.length}`);
  console.log(`  Approvals resumed: ${recResult.approvalResumed.length}`);

  const tickResult = await scheduler.tick(runId);
  console.log(`\nPost-resume tick:`);
  console.log(`  Dispatched: ${tickResult.dispatched.length}`);
  console.log(`  Run status: ${tickResult.runStatus}`);
}

async function handleStatus(args: string[]): Promise<void> {
  const runId = args[0];
  if (!runId) { console.error("Usage: alix coordination status <run-id>"); process.exit(1); }

  const cwd = process.cwd();
  const store = new CoordinationStore(cwd);
  const run = await store.load(runId);
  if (!run) { console.error(`Run not found: ${runId}`); process.exit(1); }

  const byStatus: Record<string, number> = {};
  const byBlockReason: Record<string, number> = {};
  for (const w of run.workers) {
    byStatus[w.status] = (byStatus[w.status] ?? 0) + 1;
    if (w.blockReason) byBlockReason[w.blockReason] = (byBlockReason[w.blockReason] ?? 0) + 1;
  }

  const awaitingApproval = run.workers.filter(w => w.blockReason === "approval_required" && w.approvalId);
  const ownershipConflicts = run.workers.filter(w => w.blockReason === "ownership_conflict");

  console.log(`Run: ${run.id}`);
  console.log(`Status: ${run.status}`);
  console.log(`Goal: ${run.rootGoal}`);
  console.log(`Workers: ${Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(", ")}`);
  if (awaitingApproval.length > 0) {
    console.log(`Awaiting approval: ${awaitingApproval.map(w => w.approvalId).join(", ")}`);
  }
  if (ownershipConflicts.length > 0) {
    console.log(`Ownership conflicts: ${ownershipConflicts.length}`);
  }
  console.log(`Created: ${run.createdAt}`);
  console.log(`Updated: ${run.updatedAt}`);

  // Aggregate info
  if (run.aggregateResultRef) {
    const fresh = run.aggregateSourceFingerprint ? "fresh" : "unknown";
    console.log(`Aggregate: ${run.aggregateResultRef} (${fresh})`);
  } else {
    console.log(`Aggregate: not yet generated`);
  }
  if (run.outcome) {
    console.log(`Outcome: ${run.outcome}`);
  }
  // Failure chains
  const failedWorkers = run.workers.filter(w => w.status === "failed" || w.status === "cancelled");
  if (failedWorkers.length > 0) {
    console.log(`Failed workers:`);
    for (const w of failedWorkers) {
      console.log(`  ${w.id} (${w.taskLabel}): ${w.error ?? "no error"}`);
      if (w.failureProvenance) {
        console.log(`    → root causes: ${w.failureProvenance.rootCauseWorkerIds.join(", ")}`);
        console.log(`    → propagated: ${w.failureProvenance.propagatedAt}`);
      }
    }
  }
}

async function handleCancel(args: string[]): Promise<void> {
  const runId = args[0];
  if (!runId) { console.error("Usage: alix coordination cancel <run-id>"); process.exit(1); }

  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  const store = new CoordinationStore(cwd);
  const toolRegistry = buildDefaultToolIndex().registry;
  const policyGate = new PolicyGate(config, { eventLog: undefined });
  const auth = new ExecutionAuthorization({ policyGate, toolRegistry });
  const registry = new OwnershipRegistry(cwd);
  const executor = new DefaultWorkerExecutor();

  const scheduler = new CoordinationScheduler(
    { cwd, daemonInstanceId: `cli-${process.pid}`, configProvider: async () => config, store, authorization: auth, ownershipRegistry: registry, executor },
  );

  await scheduler.cancelRun(runId);
  console.log(`Cancelled: ${runId}`);
}

async function handleResults(args: string[]): Promise<void> {
  const runId = args[0];
  if (!runId) { console.error("Usage: alix coordination results <run-id> [--json] [--refresh] [--synthesize]"); process.exit(1); }

  const jsonMode = args.includes("--json");
  const refresh = args.includes("--refresh");
  const synthesize = args.includes("--synthesize");

  const cwd = process.cwd();
  const { CoordinationStore } = await import("../../kernel/coordination-store.js");
  const { CoordinationResultStore } = await import("../../kernel/coordination-result-store.js");
  const { CoordinationAggregateStore } = await import("../../kernel/coordination-aggregate-store.js");
  const { ResultAggregator } = await import("../../kernel/coordination-result-aggregator.js");
  const { CoordinationCompletionService } = await import("../../kernel/coordination-completion-service.js");
  const { ModelRunSynthesizer } = await import("../../kernel/coordination-run-synthesizer.js");

  const store = new CoordinationStore(cwd);
  const resultStore = new CoordinationResultStore(cwd);
  const aggregateStore = new CoordinationAggregateStore(cwd);

  // Check for existing fresh aggregate
  if (!refresh) {
    const existing = await aggregateStore.load(runId);
    if (existing) {
      if (jsonMode) { console.log(JSON.stringify(existing, null, 2)); return; }
      printResultSummary(existing);
      return;
    }
  }

  // Generate aggregate
  const run = await store.load(runId);
  if (!run) { console.error(`Run not found: ${runId}`); process.exit(1); }

  const aggregator = new ResultAggregator(resultStore);
  const completionService = new CoordinationCompletionService({
    coordinationStore: store,
    resultAggregator: aggregator,
    aggregateStore,
    synthesizer: synthesize ? new ModelRunSynthesizer() : undefined,
  });

  const summary = await completionService.finalize(runId);

  if (jsonMode) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  printResultSummary(summary);
}

function printResultSummary(summary: any): void {
  console.log(`Run: ${summary.runId}`);
  console.log(`Goal: ${summary.rootGoal}`);
  console.log(`Status: ${summary.status}`);
  console.log(`Outcome: ${summary.outcome}`);
  console.log(`Complete: ${summary.complete}`);
  console.log(`Workers: ${summary.counts.workers} total, ${summary.counts.completed} completed, ${summary.counts.failed} failed, ${summary.counts.blocked} blocked`);
  console.log(`Results: ${summary.counts.successfulResults} success, ${summary.counts.failedResults} failure, ${summary.counts.missingResults} missing`);
  if (summary.timing.wallClockDurationMs !== undefined) {
    console.log(`Duration: ${(summary.timing.wallClockDurationMs / 1000).toFixed(1)}s`);
  }
  if (summary.failureChains?.length > 0) {
    console.log(`\nFailure chains:`);
    for (const chain of summary.failureChains) {
      console.log(`  Root: ${chain.rootWorkerId} (${chain.rootTaskLabel})`);
      console.log(`  Direct dependents: ${chain.directDependents.length}`);
      console.log(`  Total affected: ${chain.allAffectedWorkers.length}`);
      if (chain.rootError) console.log(`  Error: ${chain.rootError}`);
    }
  }
  if (summary.aggregateRef) {
    console.log(`\nAggregate: ${summary.aggregateRef}`);
  }
  if (summary.finalSummary) {
    console.log(`\nSynthesis:\n${summary.finalSummary}`);
  }
}
