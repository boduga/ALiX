import type { CapabilityContext, InvocationResult } from "./types.js";

export type CapabilityHooks = {
  validate?: (args: Record<string, unknown>, ctx: CapabilityContext) => string | undefined;
  canInvoke?: (ctx: CapabilityContext) => boolean;
  beforeInvoke?: (ctx: CapabilityContext) => void | Promise<void>;
  afterInvoke?: (result: InvocationResult, ctx: CapabilityContext) => void | Promise<void>;
};

/** Hooks live OUTSIDE Capability metadata. Approvals, policy, audit,
 *  metrics, and evidence plug in here without special cases. */
export class HookRegistry {
  private hooks = new Map<string, CapabilityHooks>();

  set(capabilityId: string, hooks: CapabilityHooks): void {
    this.hooks.set(capabilityId, hooks);
  }

  get(capabilityId: string): CapabilityHooks | undefined {
    return this.hooks.get(capabilityId);
  }
}
