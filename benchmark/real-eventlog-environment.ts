// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT
/**
 * RealEventLogEnvironment -- replaces FakeExecutionEnvironment boundaries
 * with real ALiX EventLog / StateProjector / ExecutionStateStore path.
 *
 * Tracer bullet for issue #639: keep EventLog authoritative, state disposable.
 * Reuses src/runtime/execution-state/* without new abstraction.
 *
 * Chain verified: real EventLog (file .alix/sessions/<sessionId>/events.jsonl)
 *   -> StateProjector (project) -> ExecutionState -> ContextBuilder ->
 *   Governor -> StepExecutor -> EventLog (append)
 *
 * @module benchmark/real-eventlog-environment
 */

import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { EventLog } from "../src/events/event-log.js";
import type { AlixEvent } from "../src/events/types.js";
import { ExecutionStateStore } from "../src/runtime/execution-state/execution-state-store.js";
import {
  project,
  toExecutionState,
  type ProjectorEvent,
  type CheckpointedExecutionState,
} from "../src/runtime/execution-state/execution-state-projector.js";
import type { ExecutionState } from "../src/runtime/execution-state/execution-state.js";
import { buildExecutionContext } from "../src/runtime/context/context-builder.js";
import { ContextRetrieval } from "../src/runtime/context/retrieval.js";
import {
  StateTransitionHarness,
  allowAllGovernor,
  allowAllResolver,
  allowAllPermission,
  noopExecutor,
  type TransitionEventLog,
} from "../src/runtime/state/state-transition.js";
import type { BenchmarkScenario, BenchmarkEvent, GovernanceConfig, DecisionPoint } from "./types.js";
import { DEFAULT_GOVERNANCE } from "./types.js";
import { estimateTokens } from "./tokens.js";

// ─── Real environment ────────────────────────────────────────────

export class RealEventLogEnvironment {
  readonly scenario: BenchmarkScenario;
  readonly governance: GovernanceConfig;
  readonly tmpDir: string;
  readonly sessionDir: string;
  readonly executionsDir: string;
  readonly eventLog: EventLog;
  readonly store: ExecutionStateStore;
  /** Production retrieval façade — real EventLog indexes + StateProjector checkpoints (#640). */
  readonly retrieval: ContextRetrieval;

  private checkpoint: CheckpointedExecutionState | null = null;
  private allEvents: readonly ProjectorEvent[] = [];

  constructor(scenario: BenchmarkScenario, governance: GovernanceConfig = DEFAULT_GOVERNANCE, tmpDir?: string) {
    this.scenario = scenario;
    this.governance = { ...governance };
    this.tmpDir = tmpDir ?? mkdtempSync(join(tmpdir(), "alix-bench-real-"));
    // Align with production layout: .alix/sessions/<sessionId>/events.jsonl and .alix/executions/<id>/state.json
    // Use executionId derived from scenario's first event payload
    const execId = (scenario.events[0]?.payload as Record<string, unknown>)?.executionId as string | undefined
      ?? `bench-${scenario.scenarioId}-${scenario.seed}-${scenario.horizon}`;
    this.sessionDir = join(this.tmpDir, ".alix", "sessions", execId);
    this.executionsDir = join(this.tmpDir, ".alix", "executions");
    this.eventLog = new EventLog(this.sessionDir);
    this.store = new ExecutionStateStore(this.executionsDir);
    this.retrieval = new ContextRetrieval(this.eventLog, this.store);
  }

  /**
   * Seed the real EventLog file from the deterministic scenario, then
   * project to ExecutionState and persist via ExecutionStateStore.
   *
   * Uses real EventLog.append (file-authoritative) so that subsequent
   * readAll()/rebuildFromEvents proves EventLog -> StateProjector -> store.
   */
  async init(): Promise<void> {
    await this.eventLog.init();
    // Append scenario events in order via real EventLog (seq auto-assigned contiguous 1..N)
    for (const e of this.scenario.events) {
      // EventLog requires NewEvent {type, payload, actor, sessionId?}; provide minimal actor
      await this.eventLog.append({
        type: e.type,
        payload: e.payload as Record<string, unknown>,
        actor: "system",
        sessionId: (e.payload as Record<string, unknown>)?.executionId as string | undefined ?? this.scenario.scenarioId,
      } as unknown as Parameters<EventLog["append"]>[0]);
    }

    const raw = await this.eventLog.readAll();
    const projEvents: ProjectorEvent[] = raw.map(a => ({
      seq: a.seq,
      type: a.type,
      payload: a.payload,
      id: a.id,
    }));
    this.allEvents = Object.freeze([...projEvents]);

    // Project deterministic checkpoint (INV-P1/P2)
    const cp = project(projEvents);
    this.checkpoint = cp;

    // Persist via store.rebuildFromEvents (EventLog authoritative, state disposable INV-10)
    // rebuildFromEvents validates schema and writes flat state.json atomically
    this.store.rebuildFromEvents(
      cp.executionId,
      projEvents as unknown as { seq?: number; type?: string; id?: string }[],
      (evs) => toExecutionState(project(evs as unknown as ProjectorEvent[])),
    );
    // Prime retrieval file-index cache for fast per-decision lookups (still file-authoritative)
    this.retrieval.primeCache();
  }

  /** Synchronous variant for callers that already wrote file synchronously (fallback) */
  initSyncFromScenario(): void {
    // Cheap sync seeding when EventLog file was pre-written via writeFileSync helper
    // kept for test convenience -- delegates to projector/store without EventLog async
    const projEvents: ProjectorEvent[] = this.scenario.events.map(e => ({
      seq: e.seq,
      type: e.type,
      payload: e.payload,
      id: e.id,
    }));
    this.allEvents = Object.freeze([...projEvents]);
    const cp = project(projEvents);
    this.checkpoint = cp;
    this.store.rebuildFromEvents(
      cp.executionId,
      projEvents as unknown as { seq?: number; type?: string; id?: string }[],
      (evs) => toExecutionState(project(evs as unknown as ProjectorEvent[])),
    );
    // Also ensure EventLog file exists for authoritative read proof (best-effort sync write)
    try {
      const filePath = join(this.sessionDir, "events.jsonl");
      if (!existsSync(filePath)) {
        mkdirSync(dirname(filePath), { recursive: true });
        const lines = this.scenario.events
          .map(e => JSON.stringify({ seq: e.seq, type: e.type, payload: e.payload, id: e.id ?? `evt-${e.seq}`, version: 1, timestamp: new Date().toISOString(), actor: "system", sessionId: this.scenario.scenarioId }))
          .join("\n") + "\n";
        writeFileSync(filePath, lines, "utf-8");
      }
      this.retrieval.primeCache();
    } catch { /* best-effort */ }
  }

  // ── Interface mirroring FakeExecutionEnvironment for substrate compatibility ──
  // All evidence/history queries now go through ContextRetrieval's real file indexes (#640).

  getFullHistory(): readonly BenchmarkEvent[] {
    // Tracer bullet #640: prefer real file index via retrieval when available,
    // fallback to cached projector events for sync callers before init().
    if (this.retrieval.hasRealEventLogFile()) {
      const all = this.retrieval.readAllSync();
      return all.map(a => ({ seq: a.seq, type: a.type, payload: a.payload, id: a.id })) as readonly BenchmarkEvent[];
    }
    if (this.allEvents.length > 0) {
      return this.allEvents.map(e => ({ seq: e.seq, type: e.type, payload: e.payload, id: e.id })) as readonly BenchmarkEvent[];
    }
    return this.scenario.events;
  }

  async getFullHistoryFromFile(): Promise<readonly BenchmarkEvent[]> {
    const all = await this.retrieval.readAll();
    return all.map(a => ({ seq: a.seq, type: a.type, payload: a.payload, id: a.id })) as readonly BenchmarkEvent[];
  }

  getLatestObservation(): unknown {
    if (this.retrieval.hasRealEventLogFile()) {
      return this.retrieval.getLatestObservationSync();
    }
    const evs = this.getFullHistory();
    const last = evs[evs.length - 1];
    return last ? last.payload : null;
  }

  /** Production retrieval: real EventLog index by evidenceId (file scan). */
  getEvidenceById(evidenceId: string): BenchmarkEvent | undefined {
    const ev = this.retrieval.getEvidenceByIdSync(evidenceId);
    return ev ? ({ seq: ev.seq, type: ev.type, payload: ev.payload, id: ev.id } as BenchmarkEvent) : undefined;
  }

  /** Async variant — real file index. */
  async getEvidenceByIdAsync(evidenceId: string): Promise<BenchmarkEvent | undefined> {
    const ev = await this.retrieval.getEvidenceById(evidenceId);
    return ev ? ({ seq: ev.seq, type: ev.type, payload: ev.payload, id: ev.id } as BenchmarkEvent) : undefined;
  }

  /** Production retrieval: real EventLog index by seq (file scan). */
  getHistorySlice(seq: number): BenchmarkEvent | undefined {
    const ev = this.retrieval.getHistorySliceSync(seq);
    return ev ? ({ seq: ev.seq, type: ev.type, payload: ev.payload, id: ev.id } as BenchmarkEvent) : undefined;
  }

  async getHistorySliceAsync(seq: number): Promise<BenchmarkEvent | undefined> {
    const ev = await this.retrieval.getHistorySlice(seq);
    return ev ? ({ seq: ev.seq, type: ev.type, payload: ev.payload, id: ev.id } as BenchmarkEvent) : undefined;
  }

  getEvidenceForDecision(evidenceId?: string): readonly BenchmarkEvent[] {
    if (!evidenceId) return [];
    const evs = this.retrieval.getEvidenceForDecisionSync(evidenceId);
    return (evs as readonly AlixEvent[]).map(a => ({ seq: a.seq, type: a.type, payload: a.payload, id: a.id })) as readonly BenchmarkEvent[];
  }

  // ── Production retrieval delegates — by executionId / evidenceId / historySlice + checkpoint ──

  /** Real EventLog index by executionId (file scan). */
  getEventsByExecutionIdSync(executionId: string): readonly BenchmarkEvent[] {
    const evs = this.retrieval.getEventsByExecutionIdSync(executionId);
    return evs.map(a => ({ seq: a.seq, type: a.type, payload: a.payload, id: a.id })) as readonly BenchmarkEvent[];
  }

  async getEventsByExecutionId(executionId: string): Promise<readonly BenchmarkEvent[]> {
    const evs = await this.retrieval.getEventsByExecutionId(executionId);
    return evs.map(a => ({ seq: a.seq, type: a.type, payload: a.payload, id: a.id })) as readonly BenchmarkEvent[];
  }

  getSummaryFixed(budgetChars = 3200): string {
    const head = JSON.stringify(this.getFullHistory().slice(0, 3));
    const tail = JSON.stringify(this.getFullHistory().slice(-2));
    const combined = `SUMMARY(${this.scenario.objective}): ${head} ... ${tail}`;
    if (combined.length <= budgetChars) return combined;
    return combined.slice(0, budgetChars);
  }

  getProjectedStateView(): unknown {
    const state = this.getExecutionState();
    if (!state) return null;
    // Return minimal bounded view mirroring FakeExecutionEnvironment shape
    // State sourced via retrieval checkpoint index (StateProjector + store) — real index (#640)
    return {
      executionId: state.executionId,
      objective: state.objective,
      step: state.step,
      status: state.status,
      pendingActions: state.pendingActions,
      activeCapabilities: state.activeCapabilities,
      evidenceHint: null,
      rawHistoryHint: null,
      version: state.version,
      latestSeq: this.checkpoint?.historyRevision ?? this.getFullHistory().length,
    };
  }

  // ── Real store / projector accessors ───────────────────────────
  // Checkpoint retrieval now uses ContextRetrieval's StateProjector checkpoint index (#640).

  getCheckpoint(): CheckpointedExecutionState | null {
    if (this.checkpoint) return this.checkpoint;
    // Fallback: load via retrieval checkpoint index (store + projector rebuild from file)
    const all = this.retrieval.readAllSync();
    if (all.length === 0) return null;
    const execId = (all[0].payload as Record<string, unknown>)?.executionId as string | undefined
      ?? this.scenario.scenarioId;
    return this.retrieval.getCheckpointSync(execId);
  }

  getExecutionState(): ExecutionState | null {
    const cp = this.getCheckpoint();
    if (cp) {
      // Prefer retrieval's checkpoint index; if checkpoint already has store snapshot, use it
      const execId = cp.executionId;
      const viaIndex = this.retrieval.getExecutionStateSync(execId);
      if (viaIndex) return viaIndex;
      return toExecutionState(cp);
    }
    if (!this.checkpoint) return null;
    // Prefer store (durable snapshot) -- proves file persistence
    const loaded = this.store.load(this.checkpoint.executionId);
    if (loaded) return loaded;
    return toExecutionState(this.checkpoint);
  }

  /** Verify EventLog authoritative, state disposable (INV-10 / INV-P7) */
  async verifyRebuildable(): Promise<boolean> {
    if (!this.checkpoint) return false;
    const raw = await this.eventLog.readAll();
    const projEvents: ProjectorEvent[] = raw.map(a => ({ seq: a.seq, type: a.type, payload: a.payload, id: a.id }));
    const rebuilt = project(projEvents);
    const stored = this.store.load(rebuilt.executionId);
    if (!stored) return false;
    // Delete and rebuild
    this.store.delete(rebuilt.executionId);
    const afterDelete = this.store.load(rebuilt.executionId);
    if (afterDelete !== null) return false;
    const rebuiltState = this.store.rebuildFromEvents(
      rebuilt.executionId,
      projEvents as unknown as { seq?: number; type?: string; id?: string }[],
      (evs) => toExecutionState(project(evs as unknown as ProjectorEvent[])),
    );
    return JSON.stringify(rebuiltState) === JSON.stringify(stored);
  }

  /** True if .alix/sessions/<id>/events.jsonl exists and contains expected count */
  hasRealEventLogFile(): boolean {
    const p = join(this.sessionDir, "events.jsonl");
    if (!existsSync(p)) return false;
    try {
      const text = readFileSync(p, "utf-8");
      const lines = text.split("\n").filter(Boolean).length;
      return lines === this.scenario.events.length;
    } catch { return false; }
  }

  hasRealStateFile(): boolean {
    if (!this.checkpoint) return false;
    return this.store.exists(this.checkpoint.executionId);
  }

  // ── End-to-end loop: ContextBuilder -> Governor -> StepExecutor -> EventLog ──

  /**
   * Run one governed transition through the real harness, demonstrating the full loop:
   * real EventLog -> StateProjector -> ExecutionState -> ContextBuilder -> Governor -> StepExecutor -> EventLog
   */
  async runGovernedStep(args: {
    patch: Record<string, unknown>;
    action?: { kind: string; capability?: string; toolName?: string; args?: Record<string, unknown> };
    governor?: typeof allowAllGovernor;
  }): Promise<{
    before: ExecutionState;
    after: ExecutionState | null;
    result: Awaited<ReturnType<StateTransitionHarness["propose"]>>;
    contextBuilt: ReturnType<typeof buildExecutionContext>;
    emittedCount: number;
  }> {
    const stateBefore = this.getExecutionState();
    if (!stateBefore) throw new Error("No ExecutionState -- did you init()?");
    // Build prompt via real ContextBuilder (P+Σ+O+E+Tools)
    const observation = this.getLatestObservation();
    const contextBuilt = buildExecutionContext(
      `skill: ${this.scenario.objective}`,
      stateBefore,
      typeof observation === "string" ? observation : JSON.stringify(observation),
      null,
      [],
    );

    const executionId = stateBefore.executionId;
    const baseStateVersion = stateBefore.version;

    // Collect appended authoritative events
    const collected: { type: string; payload: Readonly<Record<string, unknown>> }[] = [];
    const eventLogCollector: TransitionEventLog = {
      append: (events) => { for (const e of events) collected.push(e as typeof collected[number]); },
    };

    // Also append to real EventLog file for authoritative proof.
    // Rewrite execution.action_executed (harness-emitted, not projector-known) to evidence.* so
    // the projector treats it as history-advancing evidence, not an unsupported state event.
    // This keeps EventLog authoritative while preserving state determinism (INV-P7).
    const toFileType = (t: string) => (t === "execution.action_executed" ? "evidence.action_executed" : t);
    const realFileLog: TransitionEventLog = {
      append: async (events) => {
        for (const e of events) {
          await this.eventLog.append({
            type: toFileType(e.type),
            payload: e.payload as Record<string, unknown>,
            actor: "system",
            sessionId: executionId,
          } as unknown as Parameters<EventLog["append"]>[0]);
        }
      },
    };
    const combinedLog: TransitionEventLog = {
      append: async (events) => {
        await (eventLogCollector.append(events) as unknown as Promise<void>);
        await (realFileLog.append(events) as unknown as Promise<void>);
      },
    };

    const harness = new StateTransitionHarness({
      store: {
        load: (id) => this.store.load(id),
        save: (s, v) => this.store.save(s, v),
      },
      governor: args.governor ?? allowAllGovernor,
      capabilityResolver: allowAllResolver,
      permissionChecker: allowAllPermission,
      stepExecutor: noopExecutor,
      eventLog: combinedLog,
    });

    const result = await harness.propose({
      executionId,
      baseStateVersion,
      patch: args.patch as unknown as import("../src/runtime/execution-state/execution-state.js").StatePatch,
      ...(args.action ? { action: args.action } : {}),
    });

    let after: ExecutionState | null = null;
    if (result.committed) {
      // Invalidate retrieval cache — file grew
      this.retrieval.invalidateCache();
      // Refresh checkpoint from file to prove EventLog -> projector still authoritative
      const raw = await this.eventLog.readAll();
      const projEvents: ProjectorEvent[] = raw.map(a => ({ seq: a.seq, type: a.type, payload: a.payload, id: a.id }));
      const rebuilt = project(projEvents);
      this.checkpoint = rebuilt;
      after = toExecutionState(rebuilt);
      this.retrieval.primeCache();
      // Keep allEvents in sync for legacy callers
      this.allEvents = Object.freeze([...projEvents]);
    }

    return { before: stateBefore, after, result, contextBuilt, emittedCount: collected.length };
  }

  cleanup(): void {
    try { rmSync(this.tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

/** Helper to create and init a RealEventLogEnvironment for a scenario (async) */
export async function createRealEnvironment(
  scenario: BenchmarkScenario,
  governance: GovernanceConfig = DEFAULT_GOVERNANCE,
): Promise<RealEventLogEnvironment> {
  const env = new RealEventLogEnvironment(scenario, governance);
  await env.init();
  return env;
}

// ─── Token helper for real state (uses actual rendered state size) ──────

export function estimateTokensForRealState(env: RealEventLogEnvironment): number {
  const state = env.getExecutionState();
  if (!state) return 0;
  // Use same heuristic as substrates: JSON length /4
  return estimateTokens(state);
}
