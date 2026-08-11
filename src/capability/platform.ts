// src/capability/platform.ts
import { CapabilityRegistry } from "./registry.js";
import { HookRegistry } from "./hook-registry.js";
import { ProviderResolver } from "./provider-resolver.js";
import { CapabilityRuntime } from "./runtime.js";
import { NativeExecutor } from "./executors.js";
import { ProviderExecutorRegistry } from "./provider-registry.js";
import { NativeProviderExecutor, UnavailableProviderExecutor, type ProviderExecutor } from "./provider-executor.js";
import { EventBus } from "./event-bus.js";
import { CapabilityCatalog } from "./canonical/catalog.js";
import { CapabilityDefinitionStore } from "./canonical/catalog-store.js";
import { CatalogBackedCapabilityMutationPort } from "./mutation-port.js";
import { join } from "node:path";
import type { ProviderType } from "./canonical/provider.js";
import type { CapabilityQuery } from "./registry.js";
import type { Capability, CapabilityContext, Invocation } from "./types.js";

/** Composition root (CAP-4): catalog → registry → mutation port → provider
 *  registry (native + recognized-unimplemented stubs) → provider resolver →
 *  runtime. Exactly ONE CapabilityRegistry per runtime universe lives here. */
export class CapabilityPlatform {
  readonly registry: CapabilityRegistry;
  readonly catalog: CapabilityCatalog;
  readonly hooks = new HookRegistry();
  readonly providers = new ProviderExecutorRegistry();
  readonly events = new EventBus();
  readonly native = new NativeExecutor();

  private readonly resolver: ProviderResolver;
  private readonly runtime: CapabilityRuntime;

  constructor(opts: { catalogDir?: string; catalog?: CapabilityCatalog } = {}) {
    this.catalog = opts.catalog ?? new CapabilityCatalog(new CapabilityDefinitionStore({ dir: opts.catalogDir ?? join(process.cwd(), ".alix", "capabilities") }));
    this.registry = new CapabilityRegistry(this.catalog);
    this.registry.setMutationPort(new CatalogBackedCapabilityMutationPort(this.catalog));
    this.registry.setProviderBound((type) => this.providers.has(type as ProviderType));
    this.providers.register("native", new NativeProviderExecutor(this.native));
    // Recognized-but-unimplemented provider classes resolve deterministically
    // to provider_unavailable (fallback-eligible) — never missing_binding.
    for (const t of ["daemon", "agent", "plugin", "remote-api"] as const) {
      this.providers.register(t, new UnavailableProviderExecutor(t));
    }
    this.registry.attach(this.events);
    this.resolver = new ProviderResolver(this.registry, this.providers);
    this.runtime = new CapabilityRuntime(this.registry, this.hooks, this.resolver, this.events);
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

  /** Composition seam for environment-dependent providers (tool, mcp,
   *  external-cli). Type-keyed — a duplicate type throws. */
  registerProvider(type: ProviderType, executor: ProviderExecutor): void {
    this.providers.register(type, executor);
  }
}
