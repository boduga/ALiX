// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT
/**
 * Mutation-conflict benchmark — parallel state-affecting calls must not last-writer-wins.
 *
 * Scenario: State v17 → invocation inv-42 with N concurrent mutating calls sharing
 * baseStateVersion V (e.g. V=17, mutate X). Scheduler says eligible for concurrent
 * execution, but state/version authority (ExecutionStateStore CAS) determines exactly
 * one commits to v18, all conflicting fail with STATE_VERSION_CONFLICT, no conflicting
 * call produces authoritative mutation event, rebuilt state == sole committed
 * event-derived state. Scheduler does not decide winner.
 *
 * Deterministic, no LLM, no I/O, FakeModel isolated. Supports general N (N=2 default, N>2).
 *
 * Chain: StateTransitionProposal → ExecutionStateStore (CAS) → EventLog → projector
 *
 * @module benchmark/mutation-conflict
 */

import { mulberry32 } from "./scenario.js";
import {
  StateTransitionHarness,
  createInMemoryStore,
  allowAllGovernor,
  allowAllResolver,
  allowAllPermission,
  noopExecutor,
  type StateTransitionProposal,
  type StateTransitionResult,
  type TransitionEventLog,
  type TransitionStateStore,
} from "../src/runtime/state/state-transition.js";
import type { ExecutionState } from "../src/runtime/execution-state/execution-state.js";
import { EXECUTION_STATE_SCHEMA_VERSION } from "../src/runtime/execution-state/execution-state.js";
import { project, toExecutionState, type ProjectorEvent, type CheckpointedExecutionState } from "../src/runtime/execution-state/execution-state-projector.js";
import { canParallelize, DEFAULT_TOOL_EXECUTION_POLICY, scheduleToolCallsTimed, type ToolExecutionPolicy, type TimedResult } from "../src/runtime/tool-scheduler.js";
import type { ToolCall } from "../src/providers/types.js";

// ─── Constants ──────────────────────────────────────────────────────────

export const MUTATION_CONFLICT_BASE_VERSION = 17;
export const MUTATION_CONFLICT_INVOCATION_ID = "inv-42";

// Safe tool names for scheduler eligibility (mutates=false → canParallelize true even though patch mutates X)
const SAFE_TOOL_NAMES: readonly string[] = [
  "file.read",
  "file.exists",
  "dir.search",
  "web_search",
  "web_fetch",
  "done",
  "list_extensions",
  "inspect_extension",
] as const;

// ─── Scenario type ──────────────────────────────────────────────────────

export type MutationConflictScenario = Readonly<{
  scenarioId: string;
  seed: number;
  executionId: string;
  invocationId: string;
  baseStateVersion: number;
  N: number;
  /** Authoritative initial history that projects to initialState (version == baseStateVersion) */
  initialHistory: readonly ProjectorEvent[];
  initialCheckpoint: CheckpointedExecutionState;
  initialState: ExecutionState;
  proposals: readonly StateTransitionProposal[];
  toolCalls: readonly ToolCall[];
  schedulerPolicy: ToolExecutionPolicy;
  modelParallelCapable: boolean;
  schedulerEligible: boolean;
}>;

export type MutationConflictCallRecord = Readonly<{
  callId: string;
  toolCallId: string;
  invocationId: string;
  executionId: string;
  baseStateVersion: number;
  start: number;
  end: number;
  proposal: StateTransitionProposal;
  result: StateTransitionResult;
  emittedEvents: readonly { type: string; payload: Readonly<Record<string, unknown>> }[];
}>;

export type MutationConflictResult = Readonly<{
  scenario: MutationConflictScenario;
  schedulerDecision: Readonly<{ eligible: boolean; decidedWinner: null; reason: string }>;
  calls: readonly MutationConflictCallRecord[];
  committed: readonly MutationConflictCallRecord[];
  conflicts: readonly MutationConflictCallRecord[];
  /** Authoritative EventLog — only committed events */
  eventLog: readonly { type: string; payload: Readonly<Record<string, unknown>> }[];
  /** Full history for projector: initialHistory + committed events as ProjectorEvent */
  eventLogHistory: readonly ProjectorEvent[];
  finalState: ExecutionState;
  rebuiltState: CheckpointedExecutionState;
  rebuiltCore: ExecutionState;
  invariants: Readonly<{
    sameInvocation: boolean;
    sameBaseVersion: boolean;
    overlapping: boolean;
    exactlyOneSuccess: boolean;
    nMinusOneConflicts: boolean;
    noPartialMutation: boolean;
    rebuiltEqualsCommitted: boolean;
    schedulerDidNotDecideWinner: boolean;
  }>;
}>;

// ─── Helpers ────────────────────────────────────────────────────────────

function buildInitialHistory(executionId: string, baseVersion: number, seed: number): readonly ProjectorEvent[] {
  // Deterministic history that projects to version == baseVersion.
  // seq1: execution.created → v1, seq2..baseVersion: constraint_applied each +1 version
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const events: ProjectorEvent[] = [];
  events.push({
    seq: 1,
    type: "execution.created",
    payload: { executionId, objective: `initial-objective-${seed}`, intent: { intentId: `intent-${executionId}` } },
    id: `evt-1`,
  });
  for (let seq = 2; seq <= baseVersion; seq++) {
    // Use deterministic but non-colliding constraint value
    const suffix = Math.floor(rng() * 10000);
    events.push({
      seq,
      type: "execution.constraint_applied",
      payload: { kind: "init", value: `init-${seq}-${suffix}` },
      id: `evt-${seq}`,
    });
  }
  return Object.freeze([...events]);
}

// ─── Scenario factory ───────────────────────────────────────────────────

export function createMutationConflictScenario(args: {
  seed: number;
  N?: number;
  baseStateVersion?: number;
  executionId?: string;
  invocationId?: string;
  scenarioId?: string;
  schedulerPolicy?: ToolExecutionPolicy;
  modelParallelCapable?: boolean;
}): MutationConflictScenario {
  const seed = args.seed;
  const N = args.N ?? 2;
  if (!Number.isInteger(N) || N < 2) throw new Error(`N must be integer >=2, got ${N}`);
  const baseStateVersion = args.baseStateVersion ?? MUTATION_CONFLICT_BASE_VERSION;
  if (!Number.isInteger(baseStateVersion) || baseStateVersion < 1) throw new Error(`baseStateVersion must be integer >=1, got ${baseStateVersion}`);
  const executionId = args.executionId ?? `exec-mutation-${seed}`;
  const invocationId = args.invocationId ?? MUTATION_CONFLICT_INVOCATION_ID;
  const scenarioId = args.scenarioId ?? `mutation-conflict-${seed}-${N}`;
  const schedulerPolicy = args.schedulerPolicy ?? DEFAULT_TOOL_EXECUTION_POLICY;
  const modelParallelCapable = args.modelParallelCapable ?? true;

  const initialHistory = buildInitialHistory(executionId, baseStateVersion, seed);
  const initialCheckpoint = project(initialHistory);
  if (initialCheckpoint.version !== baseStateVersion) {
    throw new Error(`Initial history version mismatch: expected ${baseStateVersion}, got ${initialCheckpoint.version}`);
  }
  const initialState = toExecutionState(initialCheckpoint);

  // Deterministic proposals: same executionId, same baseStateVersion, distinct mutate X (objective)
  const rng = mulberry32(seed ^ 0x85ebca6b);
  const proposals: StateTransitionProposal[] = [];
  const toolCalls: ToolCall[] = [];
  for (let i = 0; i < N; i++) {
    const callId = `call-${String.fromCharCode(65 + (i % 26))}${i >= 26 ? `-${i}` : ""}`;
    const toolCallId = `call_${seed}_${i}`;
    // Distinct mutate value per call but same field X (objective) → conflict on same key
    const jitter = Math.floor(rng() * 1000);
    const mutateValue = `mutate-X-${callId}-seed-${seed}-${jitter}`;
    const proposal: StateTransitionProposal = {
      executionId,
      baseStateVersion,
      patch: { objective: mutateValue },
      rationale: `concurrent mutate X attempt ${callId}`,
    };
    proposals.push(Object.freeze(proposal) as StateTransitionProposal);

    const toolName = SAFE_TOOL_NAMES[i % SAFE_TOOL_NAMES.length] as string;
    toolCalls.push(Object.freeze({ id: toolCallId, name: toolName, args: { callId, baseStateVersion, invocationId } }) as unknown as ToolCall);
  }

  const schedulerEligible = canParallelize(toolCalls, schedulerPolicy, modelParallelCapable);

  return Object.freeze({
    scenarioId,
    seed,
    executionId,
    invocationId,
    baseStateVersion,
    N,
    initialHistory: Object.freeze([...initialHistory]),
    initialCheckpoint,
    initialState,
    proposals: Object.freeze([...proposals]),
    toolCalls: Object.freeze([...toolCalls]),
    schedulerPolicy: Object.freeze({ ...schedulerPolicy }),
    modelParallelCapable,
    schedulerEligible,
  });
}

// ─── Runner ─────────────────────────────────────────────────────────────

/**
 * Run the mutation-conflict scenario through StateTransitionProposal → ExecutionStateStore (CAS)
 * → EventLog → projector, proving the invariant.
 *
 * Deterministic harness, timed parallel dispatch via scheduleToolCallsTimed with delayed governor
 * to guarantee overlapping execution proof A.start < B.end && B.start < A.end.
 */
export async function runMutationConflictScenario(args: {
  seed?: number;
  N?: number;
  baseStateVersion?: number;
  executionId?: string;
  invocationId?: string;
  scenario?: MutationConflictScenario;
  /** Optional injected store/eventLog for testing (defaults to in-memory) */
  store?: TransitionStateStore;
  eventLogCollector?: { events: { type: string; payload: Readonly<Record<string, unknown>> }[] } & TransitionEventLog;
}): Promise<MutationConflictResult> {
  const scenario = args.scenario ?? createMutationConflictScenario({
    seed: args.seed ?? 42,
    N: args.N,
    baseStateVersion: args.baseStateVersion,
    executionId: args.executionId,
    invocationId: args.invocationId,
  });

  // Build store with initialState at version == baseStateVersion
  const store: TransitionStateStore = args.store ?? createInMemoryStore(scenario.initialState);

  // EventLog collector — only committed events are appended (authoritative)
  const collected: { type: string; payload: Readonly<Record<string, unknown>> }[] = [];
  const eventLog: TransitionEventLog = args.eventLogCollector ?? {
    append(events) {
      for (const e of events) collected.push(e);
    },
  };
  // Ensure collector reference points to same array for external visibility
  const collectorEvents = (eventLog as unknown as { events?: unknown[] }).events as unknown[] | undefined;
  const authoritativeCollector = collectorEvents ? (eventLog as unknown as { events: typeof collected }) : { events: collected };

  // Use delayed governor to create measurable overlapping window (20ms per call)
  // This ensures parallel dispatch yields overlapping start/end even though proposals are fast.
  const delayedGovernor = {
    evaluate: async () => {
      // Deterministic small delay; enough to make Promise.all overlap
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

  // Scheduler decision: eligible for concurrent execution (does not decide winner)
  const schedulerEligible = canParallelize(scenario.toolCalls, scenario.schedulerPolicy, scenario.modelParallelCapable);
  const schedulerDecision = {
    eligible: schedulerEligible,
    decidedWinner: null as null,
    reason: schedulerEligible
      ? "scheduler says eligible for concurrent execution — state/version authority decides commit"
      : "scheduler says serial — but benchmark forces concurrent CAS proof",
  } as const;

  // Dispatch N proposals concurrently via scheduleToolCallsTimed to capture timing proof.
  // Each execute maps toolCall index → proposal index.
  const toolCalls = scenario.toolCalls;
  const proposals = scenario.proposals;

  // Use scheduleToolCallsTimed for timing proof; if eligible, it will Promise.all (parallel)
  // otherwise we force parallel via direct Promise.all to still prove CAS invariant.
  let timed: TimedResult<StateTransitionResult>[];
  if (schedulerEligible) {
    timed = await scheduleToolCallsTimed(
      toolCalls,
      scenario.schedulerPolicy,
      scenario.modelParallelCapable,
      async tc => {
        const idx = toolCalls.findIndex(t => t.id === tc.id);
        const p = proposals[idx] as StateTransitionProposal;
        return harness.propose(p);
      },
    );
  } else {
    // Force parallel even if scheduler says serial — to prove CAS still guards (benchmark forces concurrent)
    const wrap = async (tc: ToolCall): Promise<TimedResult<StateTransitionResult>> => {
      const start = Date.now();
      const idx = toolCalls.findIndex(t => t.id === tc.id);
      const result = await harness.propose(proposals[idx] as StateTransitionProposal);
      const end = Date.now();
      return { result, start, end };
    };
    timed = await Promise.all(toolCalls.map(tc => wrap(tc)));
  }

  // Build call records with correlation hierarchy executionId → invocationId → toolCallId
  const calls: MutationConflictCallRecord[] = timed.map((tr, i) => {
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
    };
  });

  const committed = calls.filter(c => c.result.committed);
  const conflicts = calls.filter(c => !c.result.committed && (c.result as { reason?: string }).reason === "STATE_VERSION_CONFLICT");

  // Authoritative EventLog: only committed events (should be exactly one mutation)
  // Use collector array (either injected or local)
  const eventLogEvents: readonly { type: string; payload: Readonly<Record<string, unknown>> }[] =
    (authoritativeCollector.events as typeof collected).length > 0
      ? Object.freeze([...(authoritativeCollector.events as typeof collected)])
      : Object.freeze([...collected]);

  // Final state after all proposals
  const finalState = store.load(scenario.executionId);
  if (!finalState) throw new Error(`Final state missing for ${scenario.executionId}`);

  // Build full history for projector: initialHistory + committed events as ProjectorEvent with seq continuation
  const committedProjectorEvents: ProjectorEvent[] = eventLogEvents.map((e, idx) => ({
    seq: scenario.baseStateVersion + 1 + idx,
    type: e.type,
    payload: e.payload,
    id: `evt-${scenario.baseStateVersion + 1 + idx}`,
  }));
  const eventLogHistory: readonly ProjectorEvent[] = Object.freeze([...scenario.initialHistory, ...committedProjectorEvents]);
  const rebuiltState = project(eventLogHistory);
  const rebuiltCore = toExecutionState(rebuiltState);

  // Invariant checks
  const sameInvocation = calls.every(c => c.invocationId === scenario.invocationId);
  const sameBaseVersion = calls.every(c => c.baseStateVersion === scenario.baseStateVersion);
  // Overlapping proof: at least one pair satisfies A.start < B.end && B.start < A.end
  let overlapping = false;
  for (let i = 0; i < calls.length; i++) {
    for (let j = i + 1; j < calls.length; j++) {
      const a = calls[i] as MutationConflictCallRecord;
      const b = calls[j] as MutationConflictCallRecord;
      if (a.start < b.end && b.start < a.end) overlapping = true;
    }
  }
  const exactlyOneSuccess = committed.length === 1;
  const nMinusOneConflicts = conflicts.length === scenario.N - 1;
  // No partial mutation: version must be base+1, not base+N, and no extra events beyond one commit
  const noPartialMutation =
    finalState.version === scenario.baseStateVersion + 1 &&
    eventLogEvents.length === committed[0]?.emittedEvents.length &&
    eventLogEvents.length > 0;
  // Rebuilt state equals sole committed event-derived state
  const rebuiltEqualsCommitted =
    rebuiltCore.version === finalState.version &&
    rebuiltCore.executionId === finalState.executionId &&
    rebuiltCore.objective === finalState.objective &&
    JSON.stringify(rebuiltCore) === JSON.stringify(finalState);
  const schedulerDidNotDecideWinner = schedulerDecision.decidedWinner === null && schedulerDecision.eligible === true;

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
  });
}

/**
 * Synchronous helper to verify invariants throw on failure (for tests).
 * Returns true if all invariants hold, throws descriptive error otherwise.
 */
export function assertMutationConflictInvariants(result: MutationConflictResult): true {
  const inv = result.invariants;
  const failures: string[] = [];
  if (!inv.sameInvocation) failures.push("sameInvocation: not all calls share invocationId");
  if (!inv.sameBaseVersion) failures.push("sameBaseVersion: not all calls share baseStateVersion");
  if (!inv.overlapping) failures.push("overlapping: no pair satisfies A.start < B.end && B.start < A.end (not concurrent)");
  if (!inv.exactlyOneSuccess) failures.push(`exactlyOneSuccess: expected 1 committed, got ${result.committed.length}`);
  if (!inv.nMinusOneConflicts) failures.push(`nMinusOneConflicts: expected ${result.scenario.N - 1} conflicts, got ${result.conflicts.length}`);
  if (!inv.noPartialMutation) failures.push(`noPartialMutation: version ${result.finalState.version} != ${result.scenario.baseStateVersion + 1} or eventLog length mismatch`);
  if (!inv.rebuiltEqualsCommitted) failures.push("rebuiltEqualsCommitted: rebuilt state != finalState (EventLog → project → v18 must reproduce)");
  if (!inv.schedulerDidNotDecideWinner) failures.push("schedulerDidNotDecideWinner: scheduler decided winner or not eligible");
  if (failures.length > 0) throw new Error(`Mutation-conflict invariant failed: ${failures.join("; ")}`);

  // Additional checks: all conflicts are STATE_VERSION_CONFLICT, no conflicting call produced authoritative event
  for (const c of result.conflicts) {
    const r = c.result as { reason?: string };
    if (r.reason !== "STATE_VERSION_CONFLICT") failures.push(`conflict ${c.callId} reason != STATE_VERSION_CONFLICT: ${r.reason}`);
    if (c.emittedEvents.length !== 0) failures.push(`conflict ${c.callId} produced events`);
  }
  if (failures.length > 0) throw new Error(failures.join("; "));

  // Exactly one authoritative mutation event set
  if (result.eventLog.length === 0) throw new Error("eventLog empty — no authoritative mutation event");
  // Ensure final state's objective matches winner's patch (sole committed)
  const winnerObjective = (result.committed[0]?.proposal.patch as { objective?: string })?.objective;
  if (winnerObjective && result.finalState.objective !== winnerObjective) {
    throw new Error(`finalState objective mismatch: ${result.finalState.objective} != winner ${winnerObjective}`);
  }
  return true;
}
