// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-6 — A4 Capability Mutation Executor.
 *
 * A `StepExecutor` that applies the five CAP-5 governed mutations atomically
 * through A4. Each `executeStep` runs the greenfield atomicity sequence:
 * prepare → validate → apply durable mutation → project registry → record
 * governance result → commit. On any failure after apply it restores the
 * captured pre-state (byte-identical) and returns a failed step so the
 * runtime triggers rollback. Consumes CAP-5's exact semantics
 * (`validateCapabilityMutation`, `validateConsolidateMerge`,
 * `classifyUpdateBump`, `isLegalTransition`) and never invents new ones.
 *
 * @module capability-mutation-executor
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "../../security/audit/canonical-json.js";
import type { CapabilityCatalog } from "../../capability/canonical/catalog.js";
import type { CapabilityProviderBinding } from "../../capability/canonical/provider.js";
import type { CapabilityDefinition } from "../../capability/canonical/definition.js";
import { validateCapabilityDefinition } from "../../capability/canonical/definition.js";
import type { CapabilityAvailability, CapabilityRegistry } from "../../capability/registry.js";
import type { LifecycleState } from "../../adaptation/capability-evolution-types.js";
import type {
  CapabilityMutation,
  CapabilityDefinitionPatch,
  CapabilityCreateMutation,
  CapabilityUpdateMutation,
} from "../../capability/mutation-contract.js";
import { classifyUpdateBump, validateCapabilityMutation } from "../../capability/mutation-contract.js";
import type { StepExecutor } from "./execution-runtime.js";
import type { ExecutionStep, RollbackStep } from "./contracts/execution-contract.js";
import { DefaultRollbackResolver, type RollbackResolver } from "./execution-planner.js";

const MUTATION_PREFIX = "alix-capability-mutation-v1:";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Increment a full-SemVer MAJOR.MINOR.PATCH string by one step. Throws on malformed input. */
export function bumpSemVer(version: string, bump: "major" | "minor" | "patch"): string {
  const parts = version.split(".").map(Number);
  if (parts.length !== 3 || parts.some((p) => !Number.isInteger(p) || p < 0)) {
    throw new Error(`bumpSemVer: '${version}' is not full SemVer MAJOR.MINOR.PATCH`);
  }
  if (bump === "major") return `${parts[0]! + 1}.0.0`;
  if (bump === "minor") return `${parts[0]!}.${parts[1]! + 1}.0`;
  return `${parts[0]!}.${parts[1]!}.${parts[2]! + 1}`;
}

/** Apply a CAP-5 definition patch over a publication. `undefined` patch values are
 *  dropped (they mean "no change"); spread semantics replace lists, never merge.
 *  id/version/kind are immutable and never applied. Returns a NEW object. */
export function applyCapabilityDefinitionPatch(
  previous: CapabilityDefinition,
  patch: CapabilityDefinitionPatch,
): CapabilityDefinition {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) clean[k] = v;
  }
  return { ...previous, ...clean, id: previous.id, version: previous.version, kind: previous.kind };
}

/** Wrap a CAP-5 mutation as an A4 plan `changes` entry (`resolveSteps` maps it to a step). */
export function toCapabilityMutationChange(mutation: CapabilityMutation): {
  operation: CapabilityMutation["operation"];
  parameters: Record<string, unknown>;
  idempotent: boolean;
  preconditions: Record<string, unknown>;
  postconditions: Record<string, unknown>;
} {
  return {
    operation: mutation.operation,
    parameters: mutation as unknown as Record<string, unknown>,
    idempotent: false,
    preconditions: {},
    postconditions: {},
  };
}

/** Structural deep equality for two plain values (no prototype walk). Used by the
 *  update no-op guard (#480) — the same shape CAP-5's `classifyBindingsChange` uses. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

/** Apply an update patch to a publication, classify the bump (#480), and return the
 *  new immutable publication with the bumped version. Throws on any invalid state. */
export function nextDefinitionForUpdate(
  previous: CapabilityDefinition,
  patch: CapabilityDefinitionPatch,
): CapabilityDefinition {
  if ((patch as Record<string, unknown>).id !== undefined || (patch as Record<string, unknown>).version !== undefined || (patch as Record<string, unknown>).kind !== undefined) {
    throw new Error("update: 'id'/'version'/'kind' are immutable and must not appear in a patch");
  }
  const patched = applyCapabilityDefinitionPatch(previous, patch);
  validateCapabilityDefinition(patched); // throws if patch produces an invalid definition
  const bump = classifyUpdateBump(previous, patched);
  const next = { ...patched, version: bumpSemVer(previous.version, bump) };
  validateCapabilityDefinition(next);
  return next;
}

// ---------------------------------------------------------------------------
// Pre-state capture / restore (byte-identical)
// ---------------------------------------------------------------------------

export interface CapabilityPreState {
  definitions: CapabilityDefinition[];
  bindings: Map<string, CapabilityProviderBinding>;
  lifecycle: Map<string, LifecycleState | undefined>;
  availability: Map<string, CapabilityAvailability>;
}

export function capturePreState(catalog: CapabilityCatalog, registry: CapabilityRegistry): CapabilityPreState {
  const definitions = catalog.list();
  const bindings = new Map<string, CapabilityProviderBinding>();
  for (const d of definitions) {
    const b = catalog.getBinding(d.id);
    if (b) bindings.set(d.id, b);
  }
  const lifecycle = new Map<string, LifecycleState | undefined>();
  for (const { capabilityId, state } of registry.listLifecycleStates()) lifecycle.set(capabilityId, state);
  const availability = new Map<string, CapabilityAvailability>();
  for (const d of definitions) {
    const a = registry.getAvailability(d.id);
    if (a) availability.set(d.id, a);
  }
  return { definitions, bindings, lifecycle, availability };
}

/** Restore catalog + registry to a captured pre-state. Idempotent: safe to call
 *  more than once. `affectedIds` are ids the mutation touched that may not exist
 *  in the capture (e.g. a create). Restores definitions in original order, then
 *  bindings, then lifecycle/availability, re-projecting the registry. */
export function restorePreState(
  catalog: CapabilityCatalog,
  registry: CapabilityRegistry,
  affectedIds: readonly string[],
  pre: CapabilityPreState,
): void {
  const ids = new Set<string>([...affectedIds, ...pre.definitions.map((d) => d.id)]);
  for (const id of ids) catalog.remove(id);
  for (const d of pre.definitions) catalog.register(d, pre.bindings.get(d.id));
  registry.reload();
  for (const [id, state] of pre.lifecycle) {
    if (state === undefined) registry.clearLifecycleState(id);
    else registry.setLifecycleState(id, state);
  }
  for (const [id, avail] of pre.availability) registry.setAvailability(id, avail);
  registry.reload();
}

// ---------------------------------------------------------------------------
// Governance record sink + mutation result
// ---------------------------------------------------------------------------

export interface CapabilityMutationResult {
  artifactId: string;
  operation: CapabilityMutation["operation"];
  mutation: CapabilityMutation;
  preState: CapabilityPreState;
  post: Record<string, unknown>;
}

export interface GovernanceRecordSink {
  record(result: CapabilityMutationResult): Promise<void> | void;
}

function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function artifactId(operation: string, mutation: CapabilityMutation, post: Record<string, unknown>): string {
  const hash = createHash("sha256");
  hash.update(MUTATION_PREFIX);
  hash.update(canonicalStringify({ operation, mutation, post }));
  return hash.digest("hex");
}

// ---------------------------------------------------------------------------
// Rollback resolver (Task 1: create + transition; later tasks add the rest)
// ---------------------------------------------------------------------------

export function createCapabilityRollbackResolver(): RollbackResolver {
  const resolver = new DefaultRollbackResolver();
  resolver.registerOperation("capability.create", (step) => {
    // Real create steps carry the full mutation as parameters (see
    // toCapabilityMutationChange), so the capability id lives at
    // parameters.definition.id; a top-level parameters.capabilityId is
    // honored first for callers that pass it explicitly.
    const params = step.parameters as { capabilityId?: string; definition?: { id?: string } };
    return {
      stepId: `rb-${step.stepId}`,
      forwardStepId: step.stepId,
      operation: "capability.restore_create",
      parameters: { capabilityId: params.capabilityId ?? params.definition?.id },
      rollbackType: "automatic" as const,
      safe: true,
    };
  });
  resolver.registerOperation("capability.update", (step) => {
    const { capabilityId } = step.parameters as { capabilityId?: string };
    return {
      stepId: `rb-${step.stepId}`,
      forwardStepId: step.stepId,
      operation: "capability.restore_update",
      parameters: { capabilityId },
      rollbackType: "automatic" as const,
      safe: true,
    };
  });
  resolver.registerOperation("capability.transition", (step) => ({
    stepId: `rb-${step.stepId}`,
    forwardStepId: step.stepId,
    operation: "capability.restore_transition",
    parameters: { capabilityId: (step.parameters as { capabilityId?: string }).capabilityId },
    rollbackType: "automatic" as const,
    safe: true,
  }));
  return resolver;
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export interface CapabilityMutationExecutorOptions {
  catalog: CapabilityCatalog;
  registry: CapabilityRegistry;
  /** Optional governance-record sink, invoked INSIDE the atomic boundary. A
   *  throwing sink restores the pre-mutation state and fails the step. */
  record?: GovernanceRecordSink;
}

export class CapabilityMutationExecutor implements StepExecutor {
  private readonly catalog: CapabilityCatalog;
  private readonly registry: CapabilityRegistry;
  private readonly record?: GovernanceRecordSink;

  constructor(options: CapabilityMutationExecutorOptions) {
    this.catalog = options.catalog;
    this.registry = options.registry;
    this.record = options.record;
  }

  createRollbackResolver(): RollbackResolver {
    return createCapabilityRollbackResolver();
  }

  async executeStep(step: ExecutionStep, _context: Record<string, unknown>): Promise<{ success: boolean; output: Record<string, unknown>; error?: string }> {
    switch (step.operation) {
      case "capability.create":
        return this.executeCreate(step);
      case "capability.update":
        return this.executeUpdate(step);
      case "capability.transition":
        return this.executeTransition(step);
      case "capability.consolidate":
        return this.executeConsolidate(step);
      case "capability.remove":
        return this.executeRemove(step);
      default:
        return { success: false, output: {}, error: `Unknown operation: ${String(step.operation)}` };
    }
  }

  private async executeCreate(step: ExecutionStep): Promise<{ success: boolean; output: Record<string, unknown>; error?: string }> {
    const mutation = step.parameters as unknown as CapabilityCreateMutation;
    const validation = validateCapabilityMutation(mutation);
    if (!validation.valid) return { success: false, output: {}, error: validation.errors.join("; ") };
    if (this.catalog.has(mutation.definition.id)) {
      return { success: false, output: {}, error: `capability.create: '${mutation.definition.id}' already exists (use update to modify; #478)` };
    }
    const pre = capturePreState(this.catalog, this.registry);
    const result = this.applyCreate(mutation, pre);
    // Apply failure (incl. a registry projection failure after the catalog write)
    // must restore the pre-state — never leave a half-applied mutation.
    if (!result.ok) { restorePreState(this.catalog, this.registry, [mutation.definition.id], pre); return { success: false, output: {}, error: result.error }; }
    return this.commit("capability.create", mutation, [mutation.definition.id], pre, result.output ?? {});
  }

  private applyCreate(mutation: CapabilityCreateMutation, _pre: CapabilityPreState): { ok: boolean; error?: string; output?: Record<string, unknown> } {
    try {
      this.catalog.register(mutation.definition, mutation.definition.bindings[0]);
      this.registry.reload();
      const published = this.catalog.get(mutation.definition.id);
      return { ok: true, output: { published, lifecycle: "emerging" } };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Shared commit tail: build immutable result, record inside the boundary, return success. */
  private async commit(
    operation: CapabilityMutation["operation"],
    mutation: CapabilityMutation,
    affectedIds: readonly string[],
    pre: CapabilityPreState,
    post: Record<string, unknown>,
  ): Promise<{ success: boolean; output: Record<string, unknown>; error?: string }> {
    const mutationCopy = deepCopy(mutation);
    const postCopy = deepCopy(post);
    const result: CapabilityMutationResult = {
      // Hash the SAME sanitized copies that enter the result (deepCopy strips
      // nested `undefined`, which canonicalStringify would reject), so the
      // artifactId is deterministic over the recorded artifact.
      artifactId: artifactId(operation, mutationCopy, postCopy),
      operation,
      mutation: mutationCopy,
      // structuredClone preserves the Map fields of CapabilityPreState
      // (bindings/lifecycle/availability); JSON round-trip would erase them.
      preState: structuredClone(pre),
      post: postCopy,
    };
    if (this.record) {
      try {
        await this.record.record(result);
      } catch (err) {
        restorePreState(this.catalog, this.registry, affectedIds, pre);
        return { success: false, output: {}, error: `record failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
    return { success: true, output: { operation, mutation: result.mutation, result } };
  }

  private async executeUpdate(step: ExecutionStep): Promise<{ success: boolean; output: Record<string, unknown>; error?: string }> {
    const mutation = step.parameters as unknown as CapabilityUpdateMutation;
    const validation = validateCapabilityMutation(mutation);
    if (!validation.valid) return { success: false, output: {}, error: validation.errors.join("; ") };
    const previous = this.catalog.get(mutation.capabilityId);
    if (!previous) return { success: false, output: {}, error: `capability.update: '${mutation.capabilityId}' not found` };
    if (previous.version !== mutation.sourceVersion) {
      return { success: false, output: {}, error: `capability.update: sourceVersion mismatch (expected ${previous.version}, got ${mutation.sourceVersion}) — stale decision (#479)` };
    }
    // No-op guard FIRST (#480, user ruling): detect before any version allocation or
    // durable mutation — a no-op leaves no publication, no registry change, no result.
    const preBump = applyCapabilityDefinitionPatch(previous, mutation.patch);
    if (deepEqual(preBump, previous)) {
      return { success: false, output: {}, error: "capability.update: patch produces no change (#480 no-op)" };
    }
    let next: CapabilityDefinition;
    try {
      next = nextDefinitionForUpdate(previous, mutation.patch);
    } catch (err) {
      return { success: false, output: {}, error: err instanceof Error ? err.message : String(err) };
    }
    const pre = capturePreState(this.catalog, this.registry);
    const result = this.applyUpdate(next, previous);
    if (!result.ok) { restorePreState(this.catalog, this.registry, [mutation.capabilityId], pre); return { success: false, output: {}, error: result.error }; }
    // `result.output ?? {}` mirrors executeCreate: output is always set when
    // ok=true, but the union type requires the guard (matches Task 1's tail).
    return this.commit("capability.update", mutation, [mutation.capabilityId], pre, result.output ?? {});
  }

  private applyUpdate(next: CapabilityDefinition, previous: CapabilityDefinition): { ok: boolean; error?: string; output?: Record<string, unknown> } {
    try {
      this.catalog.register(next, next.bindings[0]); // append immutable id@version — never catalog.update
      this.registry.reload();
      return { ok: true, output: { published: this.catalog.get(next.id), previous, bump: classifyUpdateBump(previous, next) } };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  private async executeTransition(_step: ExecutionStep): Promise<{ success: boolean; output: Record<string, unknown>; error?: string }> {
    return { success: false, output: {}, error: "capability.transition: not implemented (Task 3)" };
  }
  private async executeConsolidate(_step: ExecutionStep): Promise<{ success: boolean; output: Record<string, unknown>; error?: string }> {
    return { success: false, output: {}, error: "capability.consolidate: not implemented (Task 4)" };
  }
  private async executeRemove(_step: ExecutionStep): Promise<{ success: boolean; output: Record<string, unknown>; error?: string }> {
    return { success: false, output: {}, error: "capability.remove: not implemented (Task 5)" };
  }
}
