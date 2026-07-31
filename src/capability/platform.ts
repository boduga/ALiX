// src/capability/platform.ts
import { CapabilityRegistry } from "./registry.js";
import { HookRegistry } from "./hook-registry.js";
import { ExecutionResolver } from "./execution-resolver.js";
import { CapabilityRuntime } from "./runtime.js";
import { ExecutorRegistry, NativeExecutor, type CapabilityExecutor } from "./executors.js";
import { EventBus } from "./event-bus.js";
import type { CapabilityQuery } from "./registry.js";
import type { Capability, CapabilityContext, Invocation } from "./types.js";

/** Composes the five platform services for consumers. No UI assumptions. */
export class CapabilityPlatform {
  readonly registry = new CapabilityRegistry();
  readonly hooks = new HookRegistry();
  readonly executors = new ExecutorRegistry();
  readonly events = new EventBus();
  readonly native = new NativeExecutor();

  private readonly resolver: ExecutionResolver;
  private readonly runtime: CapabilityRuntime;

  constructor() {
    this.executors.register("native", this.native);
    this.registry.attach(this.events);
    this.resolver = new ExecutionResolver(this.registry);
    this.runtime = new CapabilityRuntime(this.registry, this.hooks, this.resolver, this.executors, this.events);
  }

  register(capability: Capability): void { this.registry.register(capability); }
  find(id: string): Capability | undefined { return this.registry.find(id); }
  query(q: CapabilityQuery = {}): Capability[] { return this.registry.query(q); }

  invoke(
    capabilityId: string,
    args: Record<string, unknown>,
    overrides: Partial<Pick<CapabilityContext, "actor" | "cwd" | "workspace" | "sessionId" | "permissions">>,
  ): Invocation {
    return this.runtime.invoke(capabilityId, args, overrides);
  }

  registerExecutor(strategy: string, executor: CapabilityExecutor): void {
    this.executors.register(strategy, executor);
  }
}
