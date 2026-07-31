import type { Capability, CapabilityContext, ExecutorRunResult } from "./types.js";

export interface CapabilityExecutor {
  run(capability: Capability, ctx: CapabilityContext, args: Record<string, unknown>): Promise<ExecutorRunResult>;
}

export class ExecutorRegistry {
  private byStrategy = new Map<string, CapabilityExecutor>();

  register(strategy: string, executor: CapabilityExecutor): void {
    this.byStrategy.set(strategy, executor);
  }

  get(strategy: string): CapabilityExecutor | undefined {
    return this.byStrategy.get(strategy);
  }
}

export type NativeHandler = (args: Record<string, unknown>, ctx: CapabilityContext) => Promise<ExecutorRunResult> | ExecutorRunResult;

export class NativeExecutor implements CapabilityExecutor {
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

export class ToolExecutorAdapter implements CapabilityExecutor {
  constructor(private readonly runTool: (name: string, args: Record<string, unknown>) => Promise<{ output?: unknown; error?: string }>) {}

  async run(capability: Capability, ctx: CapabilityContext, args: Record<string, unknown>): Promise<ExecutorRunResult> {
    const toolName = capability.extensions?.toolName as string | undefined ?? capability.id;
    return this.runTool(toolName, args);
  }
}
