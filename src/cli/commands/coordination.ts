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
import { buildCoordinationRunView } from "../../kernel/coordination-view.js";
import { CoordinationPlanner } from "../../kernel/coordination-planner.js";
import { CoordinationScheduler } from "../../kernel/coordination-scheduler.js";
import { OwnershipRegistry } from "../../ownership/ownership-registry.js";
import { ExecutionAuthorization } from "../../runtime/execution-authorization.js";
import { PolicyGate } from "../../policy/policy-gate.js";
import { DefaultWorkerExecutor } from "../../kernel/worker-executor.js";
import { buildDefaultToolIndex } from "../../tools/tool-registry.js";
import { ConflictRepository } from "../../kernel/collaboration-conflict-repository.js";
import { CollaborationStore } from "../../kernel/collaboration-store.js";

function readFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx === -1 || idx + 1 >= args.length ? undefined : args[idx + 1];
}
function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}
function isFlagValue(args: string[], candidate: string): boolean {
  // true if `candidate` immediately follows --actor or --reason
  for (const f of ["--actor", "--reason"]) {
    const i = args.indexOf(f);
    if (i !== -1 && args[i + 1] === candidate) return true;
  }
  return false;
}
function positionalArgs(args: string[]): string[] {
  return args.filter(a => !a.startsWith("--") && !isFlagValue(args, a));
}

export async function handleCoordination(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const subcommand = args[0];
  if (!subcommand) {
    console.error("Usage: alix coordination <run|tick|resume|status|results|cancel|list|inspect|watch|workers|approvals|ownership|events> ...");
    process.exit(1);
  }

  switch (subcommand) {
    case "run": return handleRun(args.slice(1));
    case "tick": return handleTick(args.slice(1));
    case "resume": return handleResume(args.slice(1));
    case "status": return handleStatus(args.slice(1));
    case "results": return handleResults(args.slice(1));
    case "cancel": return handleCancel(args.slice(1));
    case "list":
      return handleList(cwd);
    case "inspect":
      return handleInspect(cwd, args.slice(1));
    case "watch":
      return handleWatch(cwd, args.slice(1));
    case "workers":
      return handleWorkers(cwd, args.slice(1));
    case "approvals":
      return handleApprovals(cwd, args.slice(1));
    case "ownership":
      return handleOwnership(cwd, args.slice(1));
    case "events":
      return handleEvents(cwd, args.slice(1));
    case "conflicts":
      return handleConflicts(cwd, args.slice(1));
    case "conflict":
      return handleConflict(cwd, args.slice(1));
    case "conflict-resolve":
      return handleConflictResolve(cwd, args.slice(1));
    case "conflict-dismiss":
      return handleConflictDismiss(cwd, args.slice(1));
    case "conflict-accept-divergence":
      return handleConflictAcceptDivergence(cwd, args.slice(1));
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

async function handleList(cwd: string): Promise<void> {
  const store = new CoordinationStore(cwd);
  const runs = await store.list();
  // Show all runs in a table: ID, status, outcome, workers, created
  if (runs.length === 0) { console.log("No coordination runs found."); return; }
  for (const run of runs) {
    const outcome = run.outcome ?? "-";
    console.log(`${run.id.padEnd(30)} ${run.status.padEnd(12)} ${outcome.padEnd(16)} ${String(run.workers.length).padEnd(4)} ${run.createdAt.slice(0, 19)}`);
  }
}

async function handleInspect(cwd: string, args: string[]): Promise<void> {
  const runId = args[0];
  if (!runId) { console.error("Usage: alix coordination inspect <run-id>"); process.exit(1); }
  const jsonMode = args.includes("--json");
  const view = await buildCoordinationRunView(runId, cwd);
  if (!view) { console.error(`Run not found: ${runId}`); process.exit(1); }
  if (jsonMode) { console.log(JSON.stringify(view, null, 2)); return; }

  console.log(`Run: ${view.run.id}`);
  console.log(`Goal: ${view.run.goal}`);
  console.log(`Status: ${view.run.status}`);
  if (view.run.outcome) console.log(`Outcome: ${view.run.outcome}`);
  console.log(`Workers: ${view.run.workerCount}`);
  console.log(`Freshness: ${view.freshness}`);
  console.log(`Created: ${view.run.createdAt}`);
  console.log(`Updated: ${view.run.updatedAt}`);
  if (view.failureChains.length > 0) {
    console.log(`\nFailure chains:`);
    for (const chain of view.failureChains) {
      console.log(`  Root: ${chain.rootWorkerId} (${chain.rootTaskLabel}) → ${chain.allAffectedWorkers.length} affected`);
    }
  }
  if (typeof view.conflictCount === "number" && view.conflictCount > 0) {
    console.log(`Unresolved conflicts: ${view.conflictCount}`);
    for (const c of view.conflicts ?? []) {
      console.log(`  - ${c.id}  ${c.type}  ${c.criticality}  (${c.findingCount} findings, ${c.evidenceRecommendation})`);
    }
  }
}

async function handleWatch(cwd: string, args: string[]): Promise<void> {
  const runId = args[0];
  if (!runId) { console.error("Usage: alix coordination watch <run-id>"); process.exit(1); }
  let cycles = 0;
  while (true) {
    const view = await buildCoordinationRunView(runId, cwd);
    if (!view) { console.error(`Run not found: ${runId}`); process.exit(1); }
    if (cycles > 0) process.stdout.write("\x1b[" + (view.workers.length + 8) + "A");
    console.log(`Run: ${view.run.id} — ${view.run.status} ${view.run.outcome ?? ""}`);
    console.log(`Workers: ${view.run.workerCount} | Freshness: ${view.freshness}`);
    for (const w of view.workers) {
      const dur = w.durationMs ? `${(w.durationMs / 1000).toFixed(1)}s` : "-";
      console.log(`  ${w.id.padEnd(16)} ${w.status.padEnd(12)} ${(w.outcome ?? "-").padEnd(8)} attempt ${w.attempt}  ${dur}`);
    }
    if (view.run.status === "completed" || view.run.status === "failed") break;
    await new Promise(r => setTimeout(r, 2000));
    cycles++;
  }
}

async function handleWorkers(cwd: string, args: string[]): Promise<void> {
  const runId = args[0];
  if (!runId) { console.error("Usage: alix coordination workers <run-id>"); process.exit(1); }
  const jsonMode = args.includes("--json");
  const view = await buildCoordinationRunView(runId, cwd);
  if (!view) { console.error(`Run not found: ${runId}`); process.exit(1); }
  if (jsonMode) { console.log(JSON.stringify(view.workers, null, 2)); return; }
  for (const w of view.workers) {
    const dur = w.durationMs ? `${(w.durationMs / 1000).toFixed(1)}s` : "-";
    console.log(`${w.id.padEnd(16)} ${(w.outcome ?? "-").padEnd(8)} ${w.status.padEnd(12)} attempt ${w.attempt}  ${dur}  ${w.taskLabel.slice(0, 40)}`);
    if (w.error) console.log(`  error: ${w.error}`);
    if (w.blockReason) console.log(`  blocked: ${w.blockReason}`);
  }
}

async function handleApprovals(cwd: string, args: string[]): Promise<void> {
  const runId = args[0];
  if (!runId) { console.error("Usage: alix coordination approvals <run-id>"); process.exit(1); }
  const jsonMode = args.includes("--json");
  const view = await buildCoordinationRunView(runId, cwd);
  if (!view) { console.error(`Run not found: ${runId}`); process.exit(1); }
  if (jsonMode) { console.log(JSON.stringify(view.approvals, null, 2)); return; }
  for (const a of view.approvals) {
    console.log(`${a.id.padEnd(24)} ${a.status.padEnd(12)} ${(a.capabilities ?? []).join(",").padEnd(20)} expires ${a.expiresAt.slice(0, 19)}`);
  }
  if (view.approvals.length === 0) console.log("No approvals found for this run.");
}

async function handleOwnership(cwd: string, args: string[]): Promise<void> {
  const runId = args[0];
  if (!runId) { console.error("Usage: alix coordination ownership <run-id>"); process.exit(1); }
  const jsonMode = args.includes("--json");
  const view = await buildCoordinationRunView(runId, cwd);
  if (!view) { console.error(`Run not found: ${runId}`); process.exit(1); }
  if (jsonMode) { console.log(JSON.stringify(view.ownershipLeases, null, 2)); return; }
  for (const l of view.ownershipLeases) {
    console.log(`${l.id.padEnd(24)} agent=${l.agentId} scope=${l.scope} mode=${l.mode} status=${l.status}`);
  }
  if (view.ownershipLeases.length === 0) console.log("No ownership leases found for this run.");
}

async function handleEvents(cwd: string, args: string[]): Promise<void> {
  const runId = args[0];
  if (!runId) { console.error("Usage: alix coordination events <run-id>"); process.exit(1); }
  const jsonMode = args.includes("--json");
  const view = await buildCoordinationRunView(runId, cwd);
  if (!view) { console.error(`Run not found: ${runId}`); process.exit(1); }
  if (jsonMode) { console.log(JSON.stringify(view.events, null, 2)); return; }
  for (const e of view.events) {
    console.log(`${e.timestamp.slice(0, 19)} ${e.type.padEnd(30)} ${e.workerId ?? ""}`);
  }
  if (view.events.length === 0) console.log("No coordination events found.");
}

async function handleConflicts(cwd: string, args: string[]): Promise<void> {
  const runId = args[0]; const jsonMode = args.includes("--json");
  if (!runId) { console.error("Usage: alix coordination conflicts <run-id>"); process.exit(1); }
  const store = new CollaborationStore(cwd, runId);
  const repo = new ConflictRepository(store);
  const conflicts = await repo.getConflicts(runId);
  if (jsonMode) { console.log(JSON.stringify(conflicts, null, 2)); return; }
  if (conflicts.length === 0) { console.log("No conflicts."); return; }
  for (const c of conflicts) {
    console.log(`${c.id.padEnd(30)} ${c.status.padEnd(16)} ${c.type.padEnd(20)} ${c.criticality.padEnd(10)} ${c.findingIds.length} findings`);
  }
}

async function handleConflict(cwd: string, args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");
  if (args.length < 2) { console.error("Usage: alix coordination conflict <run-id> <conflict-id>"); process.exit(1); }
  const store = new CollaborationStore(cwd, args[0]);
  const repo = new ConflictRepository(store);
  const conflict = await repo.getConflict(args[1]);
  if (!conflict) { console.error("Conflict not found."); process.exit(1); }
  if (jsonMode) { console.log(JSON.stringify(conflict, null, 2)); return; }
  console.log(`Conflict: ${conflict.id}`);
  console.log(`Topic: ${conflict.topicKey}`);
  console.log(`Type: ${conflict.type}  Status: ${conflict.status}  Criticality: ${conflict.criticality}`);
  console.log(`Findings: ${conflict.findingIds.join(", ")}`);
  console.log(`Evidence: confidence ${conflict.evidenceComparison.confidence}, recommendation ${conflict.evidenceComparison.recommendation}`);
  console.log(`History: ${conflict.history.length} entries`);
}

async function handleConflictResolve(cwd: string, args: string[]): Promise<void> {
  const positional = positionalArgs(args);
  if (positional.length < 2) {
    console.error("Usage: alix coordination conflict-resolve <run-id> <conflict-id> [--actor <id>] [--reason <text>] [--json]");
    process.exit(1);
  }
  const [runId, conflictId] = positional;
  const actor = readFlag(args, "--actor") ?? "cli";
  const reason = readFlag(args, "--reason") ?? "resolved by operator";
  const store = new CollaborationStore(cwd, runId);
  const repo = new ConflictRepository(store);
  const conflict = await repo.resolveConflict(conflictId, {
    decision: reason,
    acceptedFindingIds: [], rejectedFindingIds: [],
    resolver: { kind: "operator", id: actor },
    evidenceRefs: [], resolvedAt: new Date().toISOString(),
  }, { kind: "operator", actorId: actor });
  if (hasFlag(args, "--json")) {
    console.log(JSON.stringify(conflict, null, 2));
  } else if (!conflict) {
    console.error("Conflict not found or not authorized.");
    process.exit(1);
  } else {
    console.log(`Resolved: ${conflictId}`);
  }
}

async function handleConflictDismiss(cwd: string, args: string[]): Promise<void> {
  const positional = positionalArgs(args);
  if (positional.length < 2) {
    console.error("Usage: alix coordination conflict-dismiss <run-id> <conflict-id> [--actor <id>] [--reason <text>] [--json]");
    process.exit(1);
  }
  const [runId, conflictId] = positional;
  const actor = readFlag(args, "--actor") ?? "cli";
  const reason = readFlag(args, "--reason") ?? "dismissed by operator";
  const store = new CollaborationStore(cwd, runId);
  const repo = new ConflictRepository(store);
  const conflict = await repo.updateConflictStatus(conflictId, "dismissed", { kind: "operator", actorId: actor });
  if (hasFlag(args, "--json")) {
    console.log(JSON.stringify(conflict, null, 2));
  } else if (!conflict) {
    console.error("Conflict not found or not authorized.");
    process.exit(1);
  } else {
    console.log(`Dismissed: ${conflictId}`);
  }
}

async function handleConflictAcceptDivergence(cwd: string, args: string[]): Promise<void> {
  const positional = positionalArgs(args);
  if (positional.length < 2) {
    console.error("Usage: alix coordination conflict-accept-divergence <run-id> <conflict-id> [--actor <id>] [--reason <text>] [--json]");
    process.exit(1);
  }
  const [runId, conflictId] = positional;
  const actor = readFlag(args, "--actor") ?? "cli";
  const reason = readFlag(args, "--reason") ?? "accepted divergence";
  const store = new CollaborationStore(cwd, runId);
  const repo = new ConflictRepository(store);
  const conflict = await repo.acceptConflictDivergence(conflictId, reason, { kind: "operator", actorId: actor });
  if (hasFlag(args, "--json")) {
    console.log(JSON.stringify(conflict, null, 2));
  } else if (!conflict) {
    console.error("Conflict not found or not authorized.");
    process.exit(1);
  } else {
    console.log(`Accepted divergence: ${conflictId}`);
  }
}
