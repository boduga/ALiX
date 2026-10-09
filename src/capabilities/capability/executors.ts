import type { Capability, CapabilityContext, ExecutorRunResult } from "./types.js";

export type NativeHandler = (args: Record<string, unknown>, ctx: CapabilityContext) => Promise<ExecutorRunResult> | ExecutorRunResult;

export class NativeExecutor {
  private handlers = new Map<string, NativeHandler>();

  registerHandler(capabilityId: string, handler: NativeHandler): void {
    this.handlers.set(capabilityId, handler);
  }

  async run(capability: Capability, ctx: CapabilityContext, args: Record<string, unknown>): Promise<ExecutorRunResult> {
    const handler = this.handlers.get(capability.id);
    if (!handler) return { error: `No handler registered for ${capability.id}` };
    return handler(args, ctx);
  }
}
