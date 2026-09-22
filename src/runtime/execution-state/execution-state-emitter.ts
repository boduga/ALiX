// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * Live governed execution-state emitter (issue #616 / #628 follow-up, option A).
 *
 * Makes the task loop emit authoritative `execution.*` events through the
 * existing `StateTransitionHarness` (StateTransitionProposal → 10-gate →
 * EventLog → projector → store) instead of the read-time bridge used by
 * `benchmark/session-shadow.ts`.
 *
 * Invariants:
 *  - EventLog remains authoritative; `ExecutionState` is a derived snapshot.
 *  - Every mutation after genesis goes through `StateTransitionHarness.propose`
 *    (schema → version CAS → governor → apply → CAS persist → emit events).
 *  - Patch-only: the emitter never sends `action` (tools execute in the loop,
 *    not through this harness) — the governor denies any action proposal.
 *  - Fail-soft: no method throws into the task loop; failures are recorded on
 *    `lastError` and the loop continues with the old state.
 *  - Opt-in via `ALIX_EXECUTION_STATE_EMIT` (default off). No behavior change
 *    when disabled.
 *
 * Genesis (`execution.created` + `running`) is appended directly to the
 * EventLog and the snapshot rebuilt via `ExecutionStateStore.rebuildFromEvents`
 * (the harness cannot create — it requires an existing state).
 *
 * @module execution-state-emitter
 */

import type { EventLog } from "../../events/event-log.js";
import { ExecutionStateStore } from "./execution-state-store.js";
import {
  project,
  toExecutionState,
  EXECUTION_EVENT_TYPES,
  type ProjectorEvent,
} from "./execution-state-projector.js";
import {
  type ExecutionState,
  type ExecutionStatus,
  type StatePatch,
  validateStatePatch,
} from "./execution-state.js";
import {
  StateTransitionHarness,
  type ProposalEvent,
  type StateTransitionResult,
  type TransitionCapabilityResolver,
  type TransitionEventLog,
  type TransitionGovernor,
  type TransitionPermissionChecker,
  type TransitionStateProjector,
  type TransitionStateStore,
  type TransitionStepExecutor,
  allowAllResolver,
  allowAllPermission,
  noopExecutor,
} from "../state/state-transition.js";

const CREATED = EXECUTION_EVENT_TYPES.CREATED;
const STATUS_CHANGED = EXECUTION_EVENT_TYPES.STATUS_CHANGED;

/** Opt-in gate. Default off — the emitter is inert unless explicitly enabled. */
export function isExecutionStateEmitEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.ALIX_EXECUTION_STATE_EMIT;
  return raw === "1" || raw === "true";
}

/**
 * Live-send gate (default off). When on AND emission is on, the research
 * route may receive the state-built prompt instead of the transcript.
 * Separate flag so measurement (EMIT) and behavior change (SEND) flip
 * independently.
 */
export function isExecutionStateSendEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!isExecutionStateEmitEnabled(env)) return false;
  const raw = env.ALIX_EXECUTION_STATE_SEND;
  return raw === "1" || raw === "true";
}

/** Snapshot store directory (EventLog is the session's own log). */
export function executionStateStoreDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.ALIX_EXECUTION_STATE_DIR && env.ALIX_EXECUTION_STATE_DIR.length > 0
    ? env.ALIX_EXECUTION_STATE_DIR
    : ".alix/executions";
}

/** Patch-only governor: state bookkeeping is allowed, actions are not. */
const patchOnlyGovernor: TransitionGovernor = {
  evaluate: (proposal) =>
    proposal.action
      ? {
          decision: "deny",
          reason: "live emitter accepts patch-only proposals; tools execute in the task loop",
        }
      : { decision: "allow" },
};
function toProjectorEvents(events: readonly { seq: number; type: string; payload: unknown; id?: string }[]): ProjectorEvent[] {
  return events
    .filter((e) => e.type.startsWith("execution."))
    .map((e) => ({ seq: e.seq, type: e.type, payload: e.payload, ...(e.id ? { id: e.id } : {}) }));
}

export type ExecutionStateEmitterOptions = Readonly<{
  log: EventLog;
  sessionId: string;
  executionId: string;
  storeDir?: string;
  store?: ExecutionStateStore;
  /**
   * Governance for patch proposals. Defaults to the patch-only tracer
   * governor (allows state bookkeeping, denies actions). Production wiring
   * MUST inject the real policy governor here — the default is not an
   * authorization boundary, it only enforces patch-only shape.
   */
  governor?: TransitionGovernor;
}>;

export class ExecutionStateEmitter {
  private readonly store: ExecutionStateStore;
  private readonly harness: StateTransitionHarness;
  private lastErrorValue: string | null = null;

  constructor(private readonly opts: ExecutionStateEmitterOptions) {
    this.store = opts.store ?? new ExecutionStateStore(opts.storeDir ?? executionStateStoreDir());

    const storeAdapter: TransitionStateStore = {
      load: (id) => this.store.load(id),
      save: (state, expectedVersion) => this.store.save(state, expectedVersion),
    };
    const eventLogAdapter: TransitionEventLog = {
      append: async (events: readonly ProposalEvent[]) => {
        for (const e of events) {
          await this.opts.log.append({
            sessionId: this.opts.sessionId,
            actor: "system",
            type: e.type,
            payload: e.payload,
          });
        }
      },
    };
    const projectorAdapter: TransitionStateProjector = {
      project: (events) =>
        toExecutionState(project(toProjectorEvents(events as readonly { seq: number; type: string; payload: unknown }[]))),
    };
    const resolver: TransitionCapabilityResolver = allowAllResolver;
    const permission: TransitionPermissionChecker = allowAllPermission;
    const executor: TransitionStepExecutor = noopExecutor;

    this.harness = new StateTransitionHarness({
      store: storeAdapter,
      governor: opts.governor ?? patchOnlyGovernor,
      capabilityResolver: resolver,
      permissionChecker: permission,
      stepExecutor: executor,
      eventLog: eventLogAdapter,
      projector: projectorAdapter,
    });
  }

  get lastError(): string | null {
    return this.lastErrorValue;
  }

  /** Current derived state, or null when genesis has not run. */
  getState(): ExecutionState | null {
    try {
      return this.store.load(this.opts.executionId);
    } catch (err) {
      this.lastErrorValue = err instanceof Error ? err.message : String(err);
      return null;
    }
  }

  /**
   * Idempotent genesis: append `execution.created` + `running` and rebuild the
   * snapshot. No-op when a snapshot already exists.
   *
   * Genesis is the single documented bootstrap exception to harness-only
   * mutation: the 10-gate harness cannot create (it requires an existing
   * state for CAS), so the two genesis events are appended directly — after
   * validating the same non-empty executionId/objective the projector
   * requires. Every later mutation goes through `propose`.
   */
  async bootstrap(objective: string): Promise<void> {
    try {
      if (typeof this.opts.executionId !== "string" || this.opts.executionId.trim().length === 0) {
        this.lastErrorValue = "bootstrap rejected: executionId must be a non-empty string";
        return;
      }
      if (typeof objective !== "string" || objective.trim().length === 0) {
        this.lastErrorValue = "bootstrap rejected: objective must be a non-empty string";
        return;
      }
      if (this.store.load(this.opts.executionId)) return;
      await this.opts.log.append({
        sessionId: this.opts.sessionId,
        actor: "system",
        type: CREATED,
        payload: { executionId: this.opts.executionId, objective },
      });
      await this.opts.log.append({
        sessionId: this.opts.sessionId,
        actor: "system",
        type: STATUS_CHANGED,
        payload: { status: "running" },
      });
      const all = await this.opts.log.readAll();
      this.store.rebuildFromEvents(
        this.opts.executionId,
        toProjectorEvents(all),
        (evs) => toExecutionState(project(evs as ProjectorEvent[])),
      );
    } catch (err) {
      this.lastErrorValue = err instanceof Error ? err.message : String(err);
    }
  }

  /**
   * Model-proposal entry point (step 4): validate a model-supplied patch and
   * route it through the governed harness. Returns the harness result (or a
   * rejection envelope when there is no state / the patch is invalid) — the
   * tool layer renders it. Never throws. Version fields distinguish the two
   * failure modes: missing state reports null versions, schema failure
   * reports the current version (CAS semantics preserved).
   */
  async proposePatch(patch: StatePatch): Promise<StateTransitionResult> {
    try {
      const current = this.store.load(this.opts.executionId);
      if (!current) {
        this.lastErrorValue = "no ExecutionState (bootstrap not run)";
        return {
          committed: false,
          reason: "INVALID_PATCH",
          detail: "no ExecutionState (bootstrap not run)",
          currentVersion: null,
          expectedVersion: null,
        };
      }
      const vr = validateStatePatch(patch);
      if (!vr.valid) {
        this.lastErrorValue = `INVALID_PATCH: ${vr.errors.join("; ")}`;
        return {
          committed: false,
          reason: "INVALID_PATCH",
          detail: vr.errors.join("; "),
          currentVersion: current.version,
          expectedVersion: current.version,
        };
      }
      const result = await this.harness.propose({
        executionId: this.opts.executionId,
        baseStateVersion: current.version,
        patch,
      });
      if (!result.committed) {
        this.lastErrorValue = `${result.reason}: ${result.detail}`;
      }
      return result;
    } catch (err) {
      this.lastErrorValue = err instanceof Error ? err.message : String(err);
      return {
        committed: false,
        reason: "INVALID_PATCH",
        detail: err instanceof Error ? err.message : String(err),
        currentVersion: null,
        expectedVersion: null,
      };
    }
  }

  async setObjective(objective: string): Promise<void> {
    const current = this.getState();
    if (current && current.objective === objective) return;
    await this.proposePatch({ objective });
  }

  async setStatus(status: ExecutionStatus): Promise<void> {
    await this.proposePatch({ status });
  }

  async registerArtifact(artifact: { artifactId: string; uri: string; kind?: string }): Promise<void> {
    const current = this.getState();
    if (!current) return;
    if (current.artifacts.some((a) => a.artifactId === artifact.artifactId)) return;
    await this.proposePatch({ artifacts: [...current.artifacts, artifact] });
  }

  async bindCapability(capability: {
    capabilityId: string;
    version: string;
    availability: "available" | "unavailable" | "degraded";
  }): Promise<void> {
    const current = this.getState();
    if (!current) return;
    const next = current.activeCapabilities.filter((c) => c.capabilityId !== capability.capabilityId);
    await this.proposePatch({ activeCapabilities: [...next, capability] });
  }

  async applyConstraint(constraint: { kind: string; value: string }): Promise<void> {
    const current = this.getState();
    if (!current) return;
    if (current.constraints.some((c) => c.kind === constraint.kind && c.value === constraint.value)) return;
    await this.proposePatch({ constraints: [...current.constraints, constraint] });
  }
}
