// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import type { StepExecutor } from "../execution/execution-runtime.js";
import type { ExecutionStep } from "../execution/contracts/execution-contract.js";
import type { CapabilityRegistry } from "../../capability/registry.js";
import type { LifecycleState } from "../../adaptation/capability-evolution-types.js";

/** A7.1 — capability lifecycle step executor (A4 binding). Drives the single
 *  `capability.transition` operation. Captures pre-state at construction;
 *  `rollbackApplied()` is the bounded compensating rollback for a post-completion
 *  ledger-append failure. Pre-state is NEVER recalculated during rollback. */
export class CapabilityLifecycleStepExecutor implements StepExecutor {
  /** Pre-execution lifecycle state per touched capability id (undefined = absent). */
  private readonly preState = new Map<string, LifecycleState | undefined>();
  private readonly appliedIds: string[] = [];
  private readonly registry: CapabilityRegistry;

  constructor(registry: CapabilityRegistry, initialPreState?: Map<string, LifecycleState | undefined>) {
    this.registry = registry;
    if (initialPreState) {
      for (const [id, v] of initialPreState) this.preState.set(id, v);
    }
  }

  async executeStep(step: ExecutionStep, _context: Record<string, unknown>): Promise<{ success: boolean; output: Record<string, unknown>; error?: string }> {
    if (step.operation === "capability.restore_transition") {
      // In-plan rollback step (emitted by the capability.transition resolver): restore
      // the id to the pre-state this executor captured (or clear it if it had none).
      const { capabilityId } = step.parameters as { capabilityId: string };
      const prev = this.preState.get(capabilityId);
      if (prev === undefined) this.registry.clearLifecycleState(capabilityId);
      else this.registry.applyLifecycleTransition(capabilityId, prev);
      return { success: true, output: { capabilityId, restoredTo: prev ?? null } };
    }
    if (step.operation !== "capability.transition") {
      return { success: false, output: {}, error: `Unknown operation: ${step.operation}` };
    }
    const { capabilityId, to } = step.parameters as { capabilityId: string; to: LifecycleState };
    if (!this.preState.has(capabilityId)) {
      this.preState.set(capabilityId, this.registry.getLifecycleState(capabilityId)); // capture ONLY if not already
    }
    try {
      this.registry.applyLifecycleTransition(capabilityId, to);
      this.appliedIds.push(capabilityId);
      return { success: true, output: { capabilityId, to } };
    } catch (err) {
      return { success: false, output: {}, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Compensating rollback — restore every applied id to its pre-execution value,
   *  or clear it if it had none. Idempotent: after the first call, appliedIds is
   *  drained. `clearLifecycleState` is a no-op on an absent id. */
  rollbackApplied(): void {
    while (this.appliedIds.length > 0) {
      const id = this.appliedIds.pop()!;
      const prev = this.preState.get(id);
      if (prev === undefined) this.registry.clearLifecycleState(id);
      else this.registry.applyLifecycleTransition(id, prev);
    }
  }
}
