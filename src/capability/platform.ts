// src/capability/platform.ts
import { CapabilityRegistry } from "./registry.js";
import { HookRegistry } from "./hook-registry.js";
import { CapabilityResolver, ProviderResolver } from "./provider-resolver.js";
import { CapabilityRuntime } from "./runtime.js";
import { NativeExecutor } from "./executors.js";
import { ProviderExecutorRegistry } from "./provider-registry.js";
import { NativeProviderExecutor, UnavailableProviderExecutor, type ProviderExecutor } from "./provider-executor.js";
import { EventBus } from "./event-bus.js";
import { CapabilityCatalog } from "./canonical/catalog.js";
import { CapabilityDefinitionStore } from "./canonical/catalog-store.js";
import { CatalogBackedCapabilityMutationPort } from "./mutation-port.js";
import { CapabilityService } from "./capability-service.js";
import { CapabilityMutationExecutor } from "../evolution/execution/capability-mutation-executor.js";
import type { A7ProposalGenerator } from "./evolution/a7-proposals.js";
import type { A5CapabilityMeasurement } from "../evolution/observation/a5-capability-measurement.js";
import { CapabilityMeasurementEngine } from "./measurement/capability-measurement-engine.js";
import { ObservationEngine } from "../evolution/observation/observation-engine.js";
import { join } from "node:path";
import type { ProviderType } from "./canonical/provider.js";
import type { CapabilityQuery } from "./registry.js";
import type { Capability, CapabilityContext, Invocation } from "./types.js";
import type { EventLog } from "../events/event-log.js";

/** Composition root (CAP-4): catalog → registry → mutation port → provider
 *  registry (native + recognized-unimplemented stubs) → provider resolver →
 *  runtime. Exactly ONE CapabilityRegistry per runtime universe lives here. */
export class CapabilityPlatform {
  // PRIVATE — composition-root internals (CAP-11 ruling #8)
  private readonly registry: CapabilityRegistry;
  private readonly catalog: CapabilityCatalog;
  readonly hooks = new HookRegistry();
  readonly providers = new ProviderExecutorRegistry();
  readonly events = new EventBus();
  readonly native = new NativeExecutor();

  private readonly resolver: ProviderResolver;
  private readonly runtime: CapabilityRuntime;

  /** CapabilityService — the single mandatory capability surface (CAP-8).
   *  Wired by the composition root per locked ruling #6; the only place
   *  the service is constructed. Uses the SAME EventLog instance supplied
   *  to the platform (locked ruling #12 — EventLog is authoritative). */
  readonly service: CapabilityService;

  /** CAP-10 — measurement engine instance (optional). Absent when the
   *  platform was constructed without `a5CapabilityMeasurement`
   *  (ruling #18). Exposed for tests + downstream wiring; service.measure()
   *  remains the public surface (CAP-8 ruling #2). */
  readonly measurementEngine?: CapabilityMeasurementEngine;

  /** CapabilityPlatform constructor opts (locked ruling #12 — `eventLog`
   *  is REQUIRED; the platform never instantiates an EventLog internally).
   *  Production bootstrap (cli.ts / tui.ts) supplies the authoritative
   *  EventLog; existing platform tests MUST pass an explicit test
   *  EventLog fixture. The same instance flows through to the service. */
  constructor(opts: { catalogDir?: string; catalog?: CapabilityCatalog; eventLog: EventLog; proposalGenerator?: A7ProposalGenerator; a5CapabilityMeasurement?: A5CapabilityMeasurement }) {
    if (!opts.eventLog) {
      throw new Error("CapabilityPlatform requires an EventLog (locked ruling #12) — supply opts.eventLog");
    }
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
    // Instantiate the CapabilityResolver subclass (CAP-7) — the service
    // needs the narrow type (lifecycle accessor) for `apply()`. The
    // `ProviderResolver` superclass ref remains for back-compat with the
    // `runtime` wiring.
    const resolver = new CapabilityResolver(this.registry, this.providers);
    this.resolver = resolver;
    this.runtime = new CapabilityRuntime(this.registry, this.hooks, this.resolver, this.events);
    // CAP-6 mutation executor owned by the composition root.
    const mutationExecutor = new CapabilityMutationExecutor({ catalog: this.catalog, registry: this.registry });
    // CAP-8 — construct the service with the platform's resolver and
    // the same EventLog supplied by the caller (ruling #12). The
    // service is the only public capability surface (ruling #2).
    // CAP-10 ruling #18 — compose A5 implementation into a measurement engine (optional).
    let measurementEngine: CapabilityMeasurementEngine | undefined;
    if (opts.a5CapabilityMeasurement) {
      const observationEngine = new ObservationEngine();
      measurementEngine = new CapabilityMeasurementEngine({
        catalog: this.catalog,
        eventLog: opts.eventLog,
        a5: opts.a5CapabilityMeasurement,
        observationEngine,
      });
    }
    this.service = new CapabilityService({
      catalog: this.catalog,
      resolver,
      mutationExecutor,
      eventLog: opts.eventLog,
      proposalGenerator: opts.proposalGenerator,
      ...(measurementEngine !== undefined ? { measurementEngine } : {}),
    });
    this.measurementEngine = measurementEngine;
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
