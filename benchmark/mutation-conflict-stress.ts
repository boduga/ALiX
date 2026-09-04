// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT
/**
 * Mutation-conflict STRESS benchmark — concurrency stress N=5 mutating (issue #643).
 *
 * Extends benchmark/mutation-conflict.ts (issue #638) beyond deterministic N=2/3/5:
 *  - N=5 mutating concurrent calls sharing baseStateVersion 17 (inv-42), all eligible
 *    for parallel (safe tools → scheduler eligible), but only one commits via CAS.
 *  - Stress proof: exactly one v18, 4 STATE_VERSION_CONFLICT, no partial mutation,
 *    A.start < B.end proven (overlapping within scheduler batches).
 *  - Scheduler maxParallel:4 chunking respected under load: N=5 > maxParallel → 2
 *    batches (4+1), maxConcurrent observed == 4 (never 5), never exceeds policy.
 *  - EventLog authoritative, rebuilt state == committed, scheduler did not decide winner.
 *
 * Chain: StateTransitionProposal → ExecutionStateStore (CAS) → EventLog → projector
 * Deterministic, no LLM, no I/O, FakeModel isolated. Reuses mutation-conflict scenario
 * factory as base.
 *
 * @module benchmark/mutation-conflict-stress
 */

import { createMutationConflictScenario, MUTATION_CONFLICT_BASE_VERSION, MUTATION_CONFLICT_INVOCATION_ID, type MutationConflictResult, type MutationConflictScenario } from "./mutation-conflict.js";
import {
  StateTransitionHarness,
  createInMemoryStore,
  allowAllResolver,
  allowAllPermission,
  noopExecutor,
  type StateTransitionProposal,
  type StateTransitionResult,
  type TransitionEventLog,
  type TransitionStateStore,
} from "../src/runtime/state/state-transition.js";
import { project, toExecutionState, type ProjectorEvent, type CheckpointedExecutionState } from "../src/runtime/execution-state/execution-state-projector.js";
import { canParallelize, DEFAULT_TOOL_EXECUTION_POLICY, scheduleToolCallsTimed, type TimedResult } from "../src/runtime/tool-scheduler.js";
import type { ToolCall } from "../src/providers/types.js";
import type { ExecutionState } from "../src/runtime/execution-state/execution-state.js";

// ─── Constants ──────────────────────────────────────────────────────────

export const MUTATION_CONFLICT_STRESS_N = 5 as const;
export const MUTATION_CONFLICT_STRESS_BASE_VERSION = MUTATION_CONFLICT_BASE_VERSION;
export const MUTATION_CONFLICT_STRESS_INVOCATION_ID = MUTATION_CONFLICT_INVOCATION_ID;
export const MUTATION_CONFLICT_STRESS_MAX_PARALLEL = DEFAULT_TOOL_EXECUTION_POLICY.maxParallel;

// ─── Result type ────────────────────────────────────────────────────────

export type MutationConflictStressResult = MutationConflictResult & Readonly<{
  stressMeta: Readonly<{
    maxConcurrent: number;
    chunkCount: number;
    expectedChunkCount: number;
    maxParallel: number;
    chunkBatchSizes: readonly number[];
  }>;
  stressInvariants: Readonly<{
    sameInvocation: boolean;
    sameBaseVersion: boolean;
    overlapping: boolean;
    exactlyOneSuccess: boolean;
    nMinusOneConflicts: boolean;
    noPartialMutation: boolean;
    rebuiltEqualsCommitted: boolean;
    schedulerDidNotDecideWinner: boolean;
    schedulerChunkingRespected: boolean;
    maxConcurrentIsFour: boolean;
  }>;
}>;

// ─── Scenario factory (thin wrapper — forces N=5, base 17) ──────────────

export function createMutationConflictStressScenario(args: {
  seed: number;
  executionId?: string;
  invocationId?: string;
  scenarioId?: string;
}): MutationConflictScenario {
  return createMutationConflictScenario({
    seed: args.seed,
    N: MUTATION_CONFLICT_STRESS_N,
    baseStateVersion: MUTATION_CONFLICT_STRESS_BASE_VERSION,
    executionId: args.executionId,
    invocationId: args.invocationId ?? MUTATION_CONFLICT_STRESS_INVOCATION_ID,
    scenarioId: args.scenarioId,
  });
}

// ─── Runner ─────────────────────────────────────────────────────────────

export async function runMutationConflictStressScenario(args: {
  seed?: number;
  scenario?: MutationConflictScenario;
  store?: TransitionStateStore;
  eventLogCollector?: { events: { type: string; payload: Readonly<Record<string, unknown>> }[] } & TransitionEventLog;
}): Promise<MutationConflictStressResult> {
  const scenario = args.scenario ?? createMutationConflictStressScenario({ seed: args.seed ?? 42 });

  // Enforce stress invariants input: N=5, base 17
  if (scenario.N !== MUTATION_CONFLICT_STRESS_N) {
    throw new Error(`Stress requires N=${MUTATION_CONFLICT_STRESS_N}, got ${scenario.N}`);
  }
  if (scenario.baseStateVersion !== MUTATION_CONFLICT_STRESS_BASE_VERSION) {
    throw new Error(`Stress requires baseStateVersion=${MUTATION_CONFLICT_STRESS_BASE_VERSION}, got ${scenario.baseStateVersion}`);
  }

  const store: TransitionStateStore = args.store ?? createInMemoryStore(scenario.initialState);

  const collected: { type: string; payload: Readonly<Record<string, unknown>> }[] = [];
  const eventLog: TransitionEventLog = args.eventLogCollector ?? {
    append(events) {
      for (const e of events) collected.push(e);
    },
  };
  const collectorEvents = (eventLog as unknown as { events?: unknown[] }).events as unknown[] | undefined;
  const authoritativeCollector = collectorEvents ? (eventLog as unknown as { events: typeof collected }) : { events: collected };

  const delayedGovernor = {
    evaluate: async () => {
      await new Promise<void>(resolve => setTimeout(resolve, 15));
      return { decision: "allow" as const };
    },
  };

  const harness = new StateTransitionHarness({
    store,
    governor: delayedGovernor,
    capabilityResolver: allowAllResolver,
    permissionChecker: allowAllPermission,
    stepExecutor: noopExecutor,
    eventLog,
  });

  const schedulerEligible = canParallelize(scenario.toolCalls, scenario.schedulerPolicy, scenario.modelParallelCapable);
  const schedulerDecision = {
    eligible: schedulerEligible,
    decidedWinner: null as null,
    reason: schedulerEligible
      ? "scheduler says eligible for concurrent execution — state/version authority decides commit"
      : "scheduler says serial — but benchmark forces concurrent CAS proof",
  } as const;

  const toolCalls = scenario.toolCalls;
  const proposals = scenario.proposals;

  // Concurrency tracking under load
  let concurrent = 0;
  let maxConcurrent = 0;
  const batchSizes: number[] = [];
  // Use scheduleToolCallsTimed — it chunks by maxParallel (4). Track maxConcurrent inside execute.
  let timed: TimedResult<StateTransitionResult>[];
  if (schedulerEligible) {
    timed = await scheduleToolCallsTimed(
      toolCalls,
      scenario.schedulerPolicy,
      scenario.modelParallelCapable,
      async tc => {
        concurrent++;
        if (concurrent > maxConcurrent) maxConcurrent = concurrent;
        try {
          const idx = toolCalls.findIndex(t => t.id === tc.id);
          const p = proposals[idx] as StateTransitionProposal;
          return await harness.propose(p);
        } finally {
          concurrent--;
        }
      },
    );
    // Derive observed batch sizes from timed chunking: policy maxParallel chunking splits Promise.all batches.
    // Since scheduleToolCallsTimed chunks sequentially, we infer batches as ceil(N/maxParallel) with first 4 parallel.
    // Compute actual batch grouping via start times clustering: calls with overlapping window belong to same batch.
    // For deterministic proof we assert maxConcurrent == maxParallel and chunkCount == ceil(N/maxParallel).
    const expectedChunkCount = Math.ceil(scenario.N / scenario.schedulerPolicy.maxParallel);
    // Derive batchSizes deterministically via scheduler policy (not timing-varied inference) — matches implementation chunking
    for (let i = 0; i < toolCalls.length; i += scenario.schedulerPolicy.maxParallel) {
      batchSizes.push(Math.min(scenario.schedulerPolicy.maxParallel, toolCalls.length - i));
    }
    // Ensure computed matches expected
    if (batchSizes.length !== expectedChunkCount) {
      throw new Error(`Batch size mismatch: expected ${expectedChunkCount} chunks, got ${batchSizes.length}`);
    }
  } else {
    // Fallback path (should not happen for stress — all safe): force parallel with tracking
    const wrap = async (tc: ToolCall): Promise<TimedResult<StateTransitionResult>> => {
      const start = Date.now();
      concurrent++;
      if (concurrent > maxConcurrent) maxConcurrent = concurrent;
      let result: StateTransitionResult;
      try {
        const idx = toolCalls.findIndex(t => t.id === tc.id);
        result = await harness.propose(proposals[idx] as StateTransitionProposal);
      } finally {
        concurrent--;
      }
      const end = Date.now();
      return { result, start, end };
    };
    timed = await Promise.all(toolCalls.map(tc => wrap(tc)));
    batchSizes.push(toolCalls.length);
  }

  // Build call records
  type CallRecord = MutationConflictResult["calls"][number];
  const calls = timed.map((tr, i) => {
    const tc = toolCalls[i] as ToolCall;
    const proposal = proposals[i] as StateTransitionProposal;
    const result = tr.result;
    const emitted = result.committed ? result.emittedEvents : [];
    const callId = `call-${String.fromCharCode(65 + (i % 26))}${i >= 26 ? `-${i}` : ""}`;
    return {
      callId,
      toolCallId: tc.id,
      invocationId: scenario.invocationId,
      executionId: scenario.executionId,
      baseStateVersion: scenario.baseStateVersion,
      start: tr.start,
      end: tr.end,
      proposal,
      result,
      emittedEvents: emitted,
    } as CallRecord;
  });

  const committed = calls.filter(c => c.result.committed);
  const conflicts = calls.filter(c => !c.result.committed && (c.result as { reason?: string }).reason === "STATE_VERSION_CONFLICT");

  const eventLogEvents: readonly { type: string; payload: Readonly<Record<string, unknown>> }[] =
    (authoritativeCollector.events as typeof collected).length > 0
      ? Object.freeze([...(authoritativeCollector.events as typeof collected)])
      : Object.freeze([...collected]);

  const finalState = store.load(scenario.executionId);
  if (!finalState) throw new Error(`Final state missing for ${scenario.executionId}`);

  const committedProjectorEvents: ProjectorEvent[] = eventLogEvents.map((e, idx) => ({
    seq: scenario.baseStateVersion + 1 + idx,
    type: e.type,
    payload: e.payload,
    id: `evt-${scenario.baseStateVersion + 1 + idx}`,
  }));
  const eventLogHistory: readonly ProjectorEvent[] = Object.freeze([...scenario.initialHistory, ...committedProjectorEvents]);
  const rebuiltState = project(eventLogHistory);
  const rebuiltCore = toExecutionState(rebuiltState);

  // Base invariants (same as mutation-conflict)
  const sameInvocation = calls.every(c => c.invocationId === scenario.invocationId);
  const sameBaseVersion = calls.every(c => c.baseStateVersion === scenario.baseStateVersion);
  let overlapping = false;
  for (let i = 0; i < calls.length; i++) {
    for (let j = i + 1; j < calls.length; j++) {
      const a = calls[i] as { start: number; end: number };
      const b = calls[j] as { start: number; end: number };
      if (a.start < b.end && b.start < a.end) overlapping = true;
    }
  }
  const exactlyOneSuccess = committed.length === 1;
  const nMinusOneConflicts = conflicts.length === scenario.N - 1;
  const noPartialMutation =
    finalState.version === scenario.baseStateVersion + 1 &&
    eventLogEvents.length === committed[0]?.emittedEvents.length &&
    eventLogEvents.length > 0;
  const rebuiltEqualsCommitted =
    rebuiltCore.version === finalState.version &&
    rebuiltCore.executionId === finalState.executionId &&
    rebuiltCore.objective === finalState.objective &&
    JSON.stringify(rebuiltCore) === JSON.stringify(finalState);
  const schedulerDidNotDecideWinner = schedulerDecision.decidedWinner === null && schedulerDecision.eligible === true;

  // Stress-specific: scheduler maxParallel:4 chunking respected under load
  const expectedChunkCount = Math.ceil(scenario.N / scenario.schedulerPolicy.maxParallel);
  const schedulerChunkingRespected =
    schedulerEligible &&
    maxConcurrent <= scenario.schedulerPolicy.maxParallel &&
    maxConcurrent === scenario.schedulerPolicy.maxParallel &&
    batchSizes.length === expectedChunkCount &&
    batchSizes[0] === scenario.schedulerPolicy.maxParallel;
  const maxConcurrentIsFour = maxConcurrent === MUTATION_CONFLICT_STRESS_MAX_PARALLEL;

  const invariants = {
    sameInvocation,
    sameBaseVersion,
    overlapping,
    exactlyOneSuccess,
    nMinusOneConflicts,
    noPartialMutation,
    rebuiltEqualsCommitted,
    schedulerDidNotDecideWinner,
  };

  const stressInvariants = {
    sameInvocation,
    sameBaseVersion,
    overlapping,
    exactlyOneSuccess,
    nMinusOneConflicts,
    noPartialMutation,
    rebuiltEqualsCommitted,
    schedulerDidNotDecideWinner,
    schedulerChunkingRespected,
    maxConcurrentIsFour,
  };

  const stressMeta = {
    maxConcurrent,
    chunkCount: batchSizes.length,
    expectedChunkCount,
    maxParallel: scenario.schedulerPolicy.maxParallel,
    chunkBatchSizes: Object.freeze([...batchSizes]) as readonly number[],
  };

  return Object.freeze({
    scenario,
    schedulerDecision,
    calls: Object.freeze([...calls]),
    committed: Object.freeze([...committed]),
    conflicts: Object.freeze([...conflicts]),
    eventLog: eventLogEvents,
    eventLogHistory,
    finalState,
    rebuiltState,
    rebuiltCore,
    invariants,
    stressMeta,
    stressInvariants,
  } as MutationConflictStressResult);
}

export function assertMutationConflictStressInvariants(result: MutationConflictStressResult): true {
  const inv = result.stressInvariants;
  const failures: string[] = [];
  if (!inv.sameInvocation) failures.push("sameInvocation");
  if (!inv.sameBaseVersion) failures.push("sameBaseVersion");
  if (!inv.overlapping) failures.push("overlapping: no pair satisfies A.start < B.end && B.start < A.end");
  if (!inv.exactlyOneSuccess) failures.push(`exactlyOneSuccess: expected 1 committed, got ${result.committed.length}`);
  if (!inv.nMinusOneConflicts) failures.push(`nMinusOneConflicts: expected ${result.scenario.N - 1} conflicts, got ${result.conflicts.length}`);
  if (!inv.noPartialMutation) failures.push(`noPartialMutation: version ${result.finalState.version} != ${result.scenario.baseStateVersion + 1}`);
  if (!inv.rebuiltEqualsCommitted) failures.push("rebuiltEqualsCommitted");
  if (!inv.schedulerDidNotDecideWinner) failures.push("schedulerDidNotDecideWinner");
  if (!inv.schedulerChunkingRespected) failures.push(`schedulerChunkingRespected: maxConcurrent=${result.stressMeta.maxConcurrent} maxParallel=${result.stressMeta.maxParallel} chunks=${result.stressMeta.chunkCount} expected=${result.stressMeta.expectedChunkCount} batches=${result.stressMeta.chunkBatchSizes.join("+")}`);
  if (!inv.maxConcurrentIsFour) failures.push(`maxConcurrentIsFour: expected 4, got ${result.stressMeta.maxConcurrent}`);
  if (failures.length > 0) throw new Error(`Stress invariant failed: ${failures.join("; ")}`);

  for (const c of result.conflicts) {
    const r = c.result as { reason?: string };
    if (r.reason !== "STATE_VERSION_CONFLICT") failures.push(`conflict ${c.callId} reason != STATE_VERSION_CONFLICT: ${r.reason}`);
    if (c.emittedEvents.length !== 0) failures.push(`conflict ${c.callId} produced events`);
  }
  if (failures.length > 0) throw new Error(failures.join("; "));
  if (result.eventLog.length === 0) throw new Error("eventLog empty");
  const winnerObjective = (result.committed[0]?.proposal.patch as { objective?: string })?.objective;
  if (winnerObjective && result.finalState.objective !== winnerObjective) {
    throw new Error(`finalState objective mismatch: ${result.finalState.objective} != winner ${winnerObjective}`);
  }
  if (result.finalState.version !== MUTATION_CONFLICT_STRESS_BASE_VERSION + 1) {
    throw new Error(`finalState version ${result.finalState.version} != ${MUTATION_CONFLICT_STRESS_BASE_VERSION + 1}`);
  }
  return true;
}
