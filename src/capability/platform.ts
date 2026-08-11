// src/capability/platform.ts
import { CapabilityRegistry } from "./registry.js";
import { HookRegistry } from "./hook-registry.js";
import { ExecutionResolver } from "./execution-resolver.js";
import { CapabilityRuntime } from "./runtime.js";
import { ExecutorRegistry, NativeExecutor, type CapabilityExecutor } from "./executors.js";
import { EventBus } from "./event-bus.js";
import { CapabilityCatalog } from "./canonical/catalog.js";
import { CapabilityDefinitionStore } from "./canonical/catalog-store.js";
import { CatalogBackedCapabilityMutationPort } from "./mutation-port.js";
import { join } from "node:path";
import type { CapabilityQuery } from "./registry.js";
import type { Capability, CapabilityContext, Invocation } from "./types.js";

/** Composition root (CAP-3): load catalog → build registry → wire mutation
 *  port. Exactly ONE CapabilityRegistry per runtime universe lives here. */
export class CapabilityPlatform {
  readonly registry: CapabilityRegistry;
  readonly catalog: CapabilityCatalog;
  readonly hooks = new HookRegistry();
  readonly executors = new ExecutorRegistry();
  readonly events = new EventBus();
  readonly native = new NativeExecutor();

  private readonly resolver: ExecutionResolver;
  private readonly runtime: CapabilityRuntime;

  constructor(opts: { catalogDir?: string; catalog?: CapabilityCatalog } = {}) {
    this.catalog = opts.catalog ?? new CapabilityCatalog(new CapabilityDefinitionStore({ dir: opts.catalogDir ?? join(process.cwd(), ".alix", "capabilities") }));
    this.registry = new CapabilityRegistry(this.catalog);
    this.registry.setMutationPort(new CatalogBackedCapabilityMutationPort(this.catalog));
    this.registry.setProviderBound((type) => this.executors.get(type) !== undefined);
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
