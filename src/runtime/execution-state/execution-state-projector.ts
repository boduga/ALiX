// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * Phase 2 — State Projector  (EventLog → ExecutionState)
 *
 * Deterministic, fail-closed, no-LLM reducer. Maps typed events onto the
 * 8-field ExecutionState (objective/status/intent/pending/activeCapabilities/
 * constraints/artifacts + runtime control executionId/version/step).
 *
 * Spec: docs/ALiX-ExecutionState-Architecture.md §14-15, §41
 * Resolutions: #619 (narrow fold, typed dispatch, fail-closed,
 *   historyRevision/historyHash checkpoint INV-P7, evidence vs state)
 *   #618 (state.json snapshot, OCC CAS, lazy acquisition)
 *   #617 (8-field minimal contract)
 *
 * Invariants enforced here:
 *   INV-P1 same history → same state (deterministic, no random/time)
 *   INV-P2 never mutates history input (clone + pure)
 *   INV-P7 checkpoint  state@47 + events 48..100 == full replay 1..100
 *
 * Fail-closed: invalid lifecycle → ProjectionError with failedAtRevision
 *   Unknown state-affecting → ProjectionUnsupportedError
 *   Unknown evidence events → ignored (no mutation, but history advances)
 *
 * @module execution-state-projector
 */

import { createHash } from "node:crypto";
import {
  EXECUTION_STATE_SCHEMA_VERSION,
  EXECUTION_STATUSES,
  type ExecutionStatus,
  type ExecutionState,
  type ExecutionIntentReference,
  type PendingAction,
  type ActiveCapabilityReference,
  type ExecutionConstraint,
  type ArtifactReference,
} from "./execution-state.js";

// ─── Errors ──────────────────────────────────────────────────────────

export class ProjectionError extends Error {
  override name = "ProjectionError";
  readonly failedAtRevision: number;
  readonly eventId?: string;
  readonly reason: string;

  constructor(args: { message: string; failedAtRevision: number; eventId?: string; reason: string }) {
    super(args.message);
    this.failedAtRevision = args.failedAtRevision;
    this.eventId = args.eventId;
    this.reason = args.reason;
  }
}

export class ProjectionUnsupportedError extends ProjectionError {
  override name = "ProjectionUnsupportedError";
}

// ─── Event shape ─────────────────────────────────────────────────────

/**
 * Minimal event view consumed by the projector. Compatible with AlixEvent
 * but deliberately narrow — only seq/type/payload/id are read.
 * Caller may pass AlixEvent[] directly.
 */
export type ProjectorEvent = Readonly<{
  seq: number;
  type: string;
  payload: unknown;
  id?: string;
}>;

// ─── Checkpointed state ──────────────────────────────────────────────

/**
 * ExecutionState plus checkpoint metadata. Persisted flat as state.json
 * `{ ...ExecutionState, historyRevision, historyHash }`.
 * The core ExecutionState validates (unknown keys rejected) if you strip
 * the two checkpoint keys; the persisted file keeps them alongside.
 *
 * historyRevision: last consumed EventLog seq (monotonic, covers all
 *   events including ignored evidence events)
 * historyHash: deterministic chain hash of history (see computeHistoryHash)
 */
export type CheckpointedExecutionState = ExecutionState & Readonly<{
  historyRevision: number;
  historyHash: string;
}>;

// ─── Event types ─────────────────────────────────────────────────────

export const EXECUTION_EVENT_TYPES = {
  CREATED: "execution.created",
  OBJECTIVE_SET: "execution.objective_set",
  STATUS_CHANGED: "execution.status_changed",
  INTENT_BOUND: "execution.intent_bound",
  ACTION_PROPOSED: "execution.action_proposed",
  ACTION_STARTED: "execution.action_started",
  ACTION_COMPLETED: "execution.action_completed",
  ACTION_FAILED: "execution.action_failed",
  CAPABILITY_BOUND: "execution.capability_bound",
  CAPABILITY_UNBOUND: "execution.capability_unbound",
  CONSTRAINT_APPLIED: "execution.constraint_applied",
  CONSTRAINT_REMOVED: "execution.constraint_removed",
  ARTIFACT_REGISTERED: "execution.artifact_registered",
  ARTIFACT_REMOVED: "execution.artifact_removed",
} as const;

const STATE_AFFECTING_TYPES = new Set<string>(Object.values(EXECUTION_EVENT_TYPES));

/**
 * Returns true for events that fold into ExecutionState. Evidence/other
 * history (e.g. tool.*) is ignored by the reducer but still advances
 * the checkpoint hash/revision for INV-P7.
 */
export function isStateAffectingEventType(type: string): boolean {
  return STATE_AFFECTING_TYPES.has(type);
}

// ─── Stable stringify + hash ─────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "number" && typeof value !== "string" && typeof value !== "boolean") {
    // fall through
  }
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return "{" + keys.map(k => JSON.stringify(k) + ":" + stableStringify((value as Record<string, unknown>)[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}

/**
 * One-step chain hash: H(prevHash, event).
 * Deterministic, order-sensitive, payload-sensitive.
 */
export function hashStep(prevHash: string, event: ProjectorEvent): string {
  const payloadStr = stableStringify(event.payload);
  return createHash("sha256").update(`${prevHash}|${event.seq}|${event.type}|${payloadStr}`).digest("hex");
}

/** Initial hash seed (before any event). */
export const INITIAL_HISTORY_HASH = createHash("sha256").update("alix-execution-state-v1").digest("hex");

/**
 * Compute chain hash over sorted events. Used by project() and for
 * incremental apply() to maintain INV-P7: incremental hashing must match
 * full-replay hashing.
 */
export function computeHistoryHash(events: readonly ProjectorEvent[]): string {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  let h = INITIAL_HISTORY_HASH;
  for (const e of sorted) h = hashStep(h, e);
  return h;
}

// ─── Status lifecycle ────────────────────────────────────────────────

const TERMINAL_STATUSES: ReadonlySet<ExecutionStatus> = new Set(["completed", "failed", "cancelled"]);

const ALLOWED_TRANSITIONS: Readonly<Record<ExecutionStatus, ReadonlySet<ExecutionStatus>>> = {
  pending: new Set(["running", "cancelled"] as ExecutionStatus[]),
  running: new Set(["awaiting_approval", "completed", "failed", "cancelled"] as ExecutionStatus[]),
  awaiting_approval: new Set(["running", "completed", "failed", "cancelled"] as ExecutionStatus[]),
  completed: new Set<ExecutionStatus>([]),
  failed: new Set<ExecutionStatus>([]),
  cancelled: new Set<ExecutionStatus>([]),
};

function assertValidStatusTransition(from: ExecutionStatus, to: ExecutionStatus, seq: number, eventId?: string): void {
  if (from === to) return; // idempotent — not an error
  if ((TERMINAL_STATUSES as Set<string>).has(from)) {
    throw new ProjectionError({
      message: `Illegal status transition ${from} → ${to} from terminal status`,
      failedAtRevision: seq,
      eventId,
      reason: `terminal status ${from} cannot transition to ${to}`,
    });
  }
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed || !allowed.has(to)) {
    throw new ProjectionError({
      message: `Illegal status transition ${from} → ${to}`,
      failedAtRevision: seq,
      eventId,
      reason: `transition ${from} → ${to} not permitted`,
    });
  }
}

// ─── Payload helpers ─────────────────────────────────────────────────

function requireNonEmptyString(v: unknown, field: string, seq: number, eventId?: string): string {
  if (typeof v !== "string" || v.trim().length === 0) {
    throw new ProjectionError({
      message: `Invalid ${field}: must be non-empty string`,
      failedAtRevision: seq,
      eventId,
      reason: `${field} must be non-empty string`,
    });
  }
  return v;
}

function requireRecord(v: unknown, field: string, seq: number, eventId?: string): Record<string, unknown> {
  if (!isRecord(v)) {
    throw new ProjectionError({
      message: `Invalid ${field}: must be object`,
      failedAtRevision: seq,
      eventId,
      reason: `${field} must be object`,
    });
  }
  return v;
}

// ─── Reducers (typed EVENT TYPE → STATE EFFECT) ─────────────────────

function applyCreated(
  state: CheckpointedExecutionState | null,
  event: ProjectorEvent,
): CheckpointedExecutionState {
  const p = requireRecord(event.payload, "execution.created payload", event.seq, event.id);
  const executionId = requireNonEmptyString(p.executionId, "executionId", event.seq, event.id);
  const objective = requireNonEmptyString(p.objective, "objective", event.seq, event.id);
  if (state !== null) {
    throw new ProjectionError({
      message: `Duplicate execution.created at seq ${event.seq}`,
      failedAtRevision: event.seq,
      eventId: event.id,
      reason: "execution.created must be first and unique",
    });
  }
  // Optional intent on creation
  let intent: ExecutionIntentReference;
  if (p.intent !== undefined) {
    const r = requireRecord(p.intent, "intent", event.seq, event.id);
    intent = { intentId: requireNonEmptyString(r.intentId, "intentId", event.seq, event.id), ...(typeof r.proposalId === "string" ? { proposalId: r.proposalId } : {}) };
  } else {
    // placeholder — contract requires intent; allow creation to set sentinel if absent
    // use neutral sentinel that is valid
    intent = { intentId: executionId };
  }
  const nextHash = hashStep(INITIAL_HISTORY_HASH, event);
  const base: CheckpointedExecutionState = {
    executionId,
    schemaVersion: EXECUTION_STATE_SCHEMA_VERSION,
    version: 1,
    step: 1,
    objective,
    status: "pending",
    intent,
    pendingActions: [],
    activeCapabilities: [],
    constraints: [],
    artifacts: [],
    historyRevision: event.seq,
    historyHash: nextHash,
  };
  return base;
}

function applyObjectiveSet(state: CheckpointedExecutionState, event: ProjectorEvent): CheckpointedExecutionState {
  const p = requireRecord(event.payload, "objective_set payload", event.seq, event.id);
  const objective = requireNonEmptyString(p.objective, "objective", event.seq, event.id);
  const nextHash = hashStep(state.historyHash, event);
  return { ...state, objective, version: state.version + 1, step: state.step + 1, historyRevision: event.seq, historyHash: nextHash };
}

function applyStatusChanged(state: CheckpointedExecutionState, event: ProjectorEvent): CheckpointedExecutionState {
  const p = requireRecord(event.payload, "status_changed payload", event.seq, event.id);
  // tolerate {status} or {to} or {toStatus}
  const raw = (p.status ?? p.to ?? p.toStatus) as unknown;
  if (typeof raw !== "string" || !(EXECUTION_STATUSES as readonly string[]).includes(raw)) {
    throw new ProjectionError({
      message: `Invalid status "${String(raw)}"`,
      failedAtRevision: event.seq,
      eventId: event.id,
      reason: `status must be one of ${EXECUTION_STATUSES.join("|")}`,
    });
  }
  const to = raw as ExecutionStatus;
  assertValidStatusTransition(state.status, to, event.seq, event.id);
  if (state.status === to) {
    // no-op: still advance historyRevision/Hash but not version/step
    return { ...state, historyRevision: event.seq, historyHash: hashStep(state.historyHash, event) };
  }
  return { ...state, status: to, version: state.version + 1, step: state.step + 1, historyRevision: event.seq, historyHash: hashStep(state.historyHash, event) };
}

function applyIntentBound(state: CheckpointedExecutionState, event: ProjectorEvent): CheckpointedExecutionState {
  const p = requireRecord(event.payload, "intent_bound payload", event.seq, event.id);
  const intentId = requireNonEmptyString(p.intentId, "intentId", event.seq, event.id);
  const proposalId = typeof p.proposalId === "string" && p.proposalId.length > 0 ? p.proposalId : undefined;
  const intent: ExecutionIntentReference = proposalId ? { intentId, proposalId } : { intentId };
  return { ...state, intent, version: state.version + 1, step: state.step + 1, historyRevision: event.seq, historyHash: hashStep(state.historyHash, event) };
}

function applyActionProposed(state: CheckpointedExecutionState, event: ProjectorEvent): CheckpointedExecutionState {
  const p = requireRecord(event.payload, "action payload", event.seq, event.id);
  const actionId = requireNonEmptyString(p.actionId, "actionId", event.seq, event.id);
  const kind = requireNonEmptyString(p.kind, "kind", event.seq, event.id);
  const description = typeof p.description === "string" ? p.description : undefined;
  // dedup by actionId — idempotent add
  if (state.pendingActions.some(a => a.actionId === actionId)) {
    return { ...state, historyRevision: event.seq, historyHash: hashStep(state.historyHash, event) };
  }
  const pa: PendingAction = description ? { actionId, kind, description } : { actionId, kind };
  return {
    ...state,
    pendingActions: [...state.pendingActions, pa],
    version: state.version + 1,
    step: state.step + 1,
    historyRevision: event.seq,
    historyHash: hashStep(state.historyHash, event),
  };
}

function applyActionCompleted(state: CheckpointedExecutionState, event: ProjectorEvent): CheckpointedExecutionState {
  const p = requireRecord(event.payload, "action completion payload", event.seq, event.id);
  const actionId = requireNonEmptyString(p.actionId, "actionId", event.seq, event.id);
  // remove from pending (set difference)
  const filtered = state.pendingActions.filter(a => a.actionId !== actionId);
  const changed = filtered.length !== state.pendingActions.length;
  if (!changed) {
    return { ...state, historyRevision: event.seq, historyHash: hashStep(state.historyHash, event) };
  }
  return {
    ...state,
    pendingActions: filtered,
    version: state.version + 1,
    step: state.step + 1,
    historyRevision: event.seq,
    historyHash: hashStep(state.historyHash, event),
  };
}

function applyCapabilityBound(state: CheckpointedExecutionState, event: ProjectorEvent): CheckpointedExecutionState {
  const p = requireRecord(event.payload, "capability_bound payload", event.seq, event.id);
  const capabilityId = requireNonEmptyString(p.capabilityId, "capabilityId", event.seq, event.id);
  const version = requireNonEmptyString(p.version, "version", event.seq, event.id);
  const availabilityRaw = p.availability as unknown;
  if (availabilityRaw !== "available" && availabilityRaw !== "unavailable" && availabilityRaw !== "degraded") {
    throw new ProjectionError({
      message: `Invalid availability "${String(availabilityRaw)}"`,
      failedAtRevision: event.seq,
      eventId: event.id,
      reason: "availability must be available|unavailable|degraded",
    });
  }
  const availability = availabilityRaw as ActiveCapabilityReference["availability"];
  const ref: ActiveCapabilityReference = { capabilityId, version, availability };
  // upsert by capabilityId
  const idx = state.activeCapabilities.findIndex(c => c.capabilityId === capabilityId);
  let next: readonly ActiveCapabilityReference[];
  if (idx >= 0) {
    next = state.activeCapabilities.map((c, i) => (i === idx ? ref : c));
  } else {
    next = [...state.activeCapabilities, ref];
  }
  return { ...state, activeCapabilities: next, version: state.version + 1, step: state.step + 1, historyRevision: event.seq, historyHash: hashStep(state.historyHash, event) };
}

function applyCapabilityUnbound(state: CheckpointedExecutionState, event: ProjectorEvent): CheckpointedExecutionState {
  const p = requireRecord(event.payload, "capability_unbound payload", event.seq, event.id);
  const capabilityId = requireNonEmptyString(p.capabilityId, "capabilityId", event.seq, event.id);
  const next = state.activeCapabilities.filter(c => c.capabilityId !== capabilityId);
  if (next.length === state.activeCapabilities.length) {
    return { ...state, historyRevision: event.seq, historyHash: hashStep(state.historyHash, event) };
  }
  return { ...state, activeCapabilities: next, version: state.version + 1, step: state.step + 1, historyRevision: event.seq, historyHash: hashStep(state.historyHash, event) };
}

function applyConstraintApplied(state: CheckpointedExecutionState, event: ProjectorEvent): CheckpointedExecutionState {
  const p = requireRecord(event.payload, "constraint payload", event.seq, event.id);
  const kind = requireNonEmptyString(p.kind, "kind", event.seq, event.id);
  const value = requireNonEmptyString(p.value, "value", event.seq, event.id);
  const constraint: ExecutionConstraint = { kind, value };
  // dedup by kind+value
  if (state.constraints.some(c => c.kind === kind && c.value === value)) {
    return { ...state, historyRevision: event.seq, historyHash: hashStep(state.historyHash, event) };
  }
  return {
    ...state,
    constraints: [...state.constraints, constraint],
    version: state.version + 1,
    step: state.step + 1,
    historyRevision: event.seq,
    historyHash: hashStep(state.historyHash, event),
  };
}

function applyConstraintRemoved(state: CheckpointedExecutionState, event: ProjectorEvent): CheckpointedExecutionState {
  const p = requireRecord(event.payload, "constraint remove payload", event.seq, event.id);
  const kind = requireNonEmptyString(p.kind, "kind", event.seq, event.id);
  const value = requireNonEmptyString(p.value, "value", event.seq, event.id);
  const next = state.constraints.filter(c => !(c.kind === kind && c.value === value));
  if (next.length === state.constraints.length) {
    return { ...state, historyRevision: event.seq, historyHash: hashStep(state.historyHash, event) };
  }
  return { ...state, constraints: next, version: state.version + 1, step: state.step + 1, historyRevision: event.seq, historyHash: hashStep(state.historyHash, event) };
}

function applyArtifactRegistered(state: CheckpointedExecutionState, event: ProjectorEvent): CheckpointedExecutionState {
  const p = requireRecord(event.payload, "artifact payload", event.seq, event.id);
  const artifactId = requireNonEmptyString(p.artifactId, "artifactId", event.seq, event.id);
  const uri = requireNonEmptyString(p.uri, "uri", event.seq, event.id);
  const kind = typeof p.kind === "string" ? p.kind : undefined;
  const ref: ArtifactReference = kind ? { artifactId, uri, kind } : { artifactId, uri };
  if (state.artifacts.some(a => a.artifactId === artifactId)) {
    // replace semantics for same id
    const next = state.artifacts.map(a => (a.artifactId === artifactId ? ref : a));
    return { ...state, artifacts: next, version: state.version + 1, step: state.step + 1, historyRevision: event.seq, historyHash: hashStep(state.historyHash, event) };
  }
  return {
    ...state,
    artifacts: [...state.artifacts, ref],
    version: state.version + 1,
    step: state.step + 1,
    historyRevision: event.seq,
    historyHash: hashStep(state.historyHash, event),
  };
}

function applyArtifactRemoved(state: CheckpointedExecutionState, event: ProjectorEvent): CheckpointedExecutionState {
  const p = requireRecord(event.payload, "artifact remove payload", event.seq, event.id);
  const artifactId = requireNonEmptyString(p.artifactId, "artifactId", event.seq, event.id);
  const next = state.artifacts.filter(a => a.artifactId !== artifactId);
  if (next.length === state.artifacts.length) {
    return { ...state, historyRevision: event.seq, historyHash: hashStep(state.historyHash, event) };
  }
  return { ...state, artifacts: next, version: state.version + 1, step: state.step + 1, historyRevision: event.seq, historyHash: hashStep(state.historyHash, event) };
}

// ─── Typed dispatch ─────────────────────────────────────────────────

type Reducer = (state: CheckpointedExecutionState, event: ProjectorEvent) => CheckpointedExecutionState;

const REDUCERS: Readonly<Record<string, Reducer>> = {
  [EXECUTION_EVENT_TYPES.OBJECTIVE_SET]: applyObjectiveSet,
  [EXECUTION_EVENT_TYPES.STATUS_CHANGED]: applyStatusChanged,
  [EXECUTION_EVENT_TYPES.INTENT_BOUND]: applyIntentBound,
  [EXECUTION_EVENT_TYPES.ACTION_PROPOSED]: applyActionProposed,
  [EXECUTION_EVENT_TYPES.ACTION_STARTED]: applyActionProposed, // same set semantics
  [EXECUTION_EVENT_TYPES.ACTION_COMPLETED]: applyActionCompleted,
  [EXECUTION_EVENT_TYPES.ACTION_FAILED]: applyActionCompleted,   // failed also removes from pending
  [EXECUTION_EVENT_TYPES.CAPABILITY_BOUND]: applyCapabilityBound,
  [EXECUTION_EVENT_TYPES.CAPABILITY_UNBOUND]: applyCapabilityUnbound,
  [EXECUTION_EVENT_TYPES.CONSTRAINT_APPLIED]: applyConstraintApplied,
  [EXECUTION_EVENT_TYPES.CONSTRAINT_REMOVED]: applyConstraintRemoved,
  [EXECUTION_EVENT_TYPES.ARTIFACT_REGISTERED]: applyArtifactRegistered,
  [EXECUTION_EVENT_TYPES.ARTIFACT_REMOVED]: applyArtifactRemoved,
};

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Apply a single event to a checkpointed state.
 * - Does NOT mutate inputs (returns new object).
 * - For evidence/unknown-non-state events: advances historyRevision/Hash
 *   without changing ExecutionState core or version (keeps INV-P7 correct).
 * - For known state-affecting events: typed reducer with validation.
 * - For `execution.*` unknown types: fail-closed ProjectionUnsupportedError.
 */
export function applyEvent(
  state: CheckpointedExecutionState | null,
  event: ProjectorEvent,
): CheckpointedExecutionState {
  // Defensive: never mutate caller's event
  const ev: ProjectorEvent = { seq: event.seq, type: String(event.type), payload: event.payload, ...(event.id ? { id: event.id } : {}) };

  if (ev.type === EXECUTION_EVENT_TYPES.CREATED) {
    return applyCreated(state, ev);
  }

  if (state === null) {
    // No execution yet — only CREATED is valid; others must fail closed
    if (isStateAffectingEventType(ev.type)) {
      throw new ProjectionError({
        message: `Event ${ev.type} at seq ${ev.seq} before execution.created`,
        failedAtRevision: ev.seq,
        eventId: ev.id,
        reason: "state events require prior execution.created",
      });
    }
    if (ev.type.startsWith("execution.")) {
      throw new ProjectionUnsupportedError({
        message: `Unsupported execution event ${ev.type} before creation`,
        failedAtRevision: ev.seq,
        eventId: ev.id,
        reason: `unknown execution event type ${ev.type}`,
      });
    }
    // Evidence before creation — create a no-op hash progression but still need a state?
    // Without created there is no ExecutionState; treat as unsupported to fail closed
    // only if evidence needs to be retained — for now ignore until created, hash starts after.
    // Return null-like can't exist; so throw to require created first.
    throw new ProjectionError({
      message: `History must start with execution.created (got ${ev.type} at seq ${ev.seq})`,
      failedAtRevision: ev.seq,
      eventId: ev.id,
      reason: "first event must be execution.created",
    });
  }

  // Known state-affecting reducer
  const reducer = REDUCERS[ev.type];
  if (reducer) {
    // clone is handled by reducer returning new object; ensure no mutation of original
    return reducer(state, ev);
  }

  if (ev.type.startsWith("execution.")) {
    throw new ProjectionUnsupportedError({
      message: `Unsupported execution event type "${ev.type}" at seq ${ev.seq}`,
      failedAtRevision: ev.seq,
      eventId: ev.id,
      reason: `unknown state-affecting event type ${ev.type}`,
    });
  }

  // Evidence / irrelevant history — advance checkpoint hash/revision only, keep state
  return {
    ...state,
    historyRevision: ev.seq,
    historyHash: hashStep(state.historyHash, ev),
  };
}

/**
 * Deterministic projection over an entire history.
 * - Does NOT mutate input array or events (INV-P2).
 * - Input order is ignored: sorted by seq ascending (deterministic).
 * - Returns CheckpointedExecutionState with historyRevision/historyHash.
 * - INV-P1: same history (seq+type+payload) → same state (no random/time).
 *
 * Throws ProjectionError / ProjectionUnsupportedError on invalid history
 * (fail-closed, with failedAtRevision).
 */
export function project(events: readonly ProjectorEvent[]): CheckpointedExecutionState {
  // INV-P2: copy, never sort in place; never mutate payloads
  const copy = [...events];
  copy.sort((a, b) => a.seq - b.seq);

  let state: CheckpointedExecutionState | null = null;
  for (const e of copy) {
    state = applyEvent(state, e);
  }
  if (state === null) {
    throw new ProjectionError({
      message: "Cannot project empty history — no execution.created",
      failedAtRevision: 0,
      reason: "history must contain execution.created",
    });
  }
  return state;
}

/**
 * Incrementally apply events onto an existing checkpoint.
 * Use to prove INV-P7: project(1..100) === apply(project(1..47), 48..100)
 * Events are sorted; checkpoint's historyRevision must be < next event seq
 * otherwise duplicates are handled idempotently via hash progression.
 */
export function projectFromCheckpoint(
  checkpoint: CheckpointedExecutionState,
  events: readonly ProjectorEvent[],
): CheckpointedExecutionState {
  const copy = [...events].sort((a, b) => a.seq - b.seq);
  let state: CheckpointedExecutionState = checkpoint;
  for (const e of copy) {
    // Skip already-applied seqs (idempotent incremental apply)
    if (e.seq <= state.historyRevision) continue;
    state = applyEvent(state, e);
  }
  return state;
}

/**
 * Strip checkpoint metadata to obtain the pure ExecutionState for validation.
 */
export function toExecutionState(checkpointed: CheckpointedExecutionState): ExecutionState {
  const { historyRevision: _r, historyHash: _h, ...core } = checkpointed as CheckpointedExecutionState & { historyRevision: number; historyHash: string };
  return core as ExecutionState;
}
