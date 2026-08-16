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
import type { CapabilityDefinition } from "./canonical/definition.js";
import { CapabilityDefinitionStore } from "./canonical/catalog-store.js";
import { CatalogBackedCapabilityMutationPort } from "./mutation-port.js";
import { CapabilityService } from "./capability-service.js";
import { CapabilityMutationExecutor } from "../evolution/execution/capability-mutation-executor.js";
import { A7ProposalGenerator, type ProposalSignalSource } from "./evolution/a7-proposals.js";
import { ProposalSignalChannel } from "./evolution/proposal-signal-channel.js";
import {
  buildOverlapSignals,
  compositeProposalSignalSource,
} from "./evolution/overlap-signal-source.js";
import { CapabilityOverlapAnalyzer } from "../adaptation/capability-overlap-analyzer.js";
import { A5CapabilityMeasurement } from "../evolution/observation/a5-capability-measurement.js";
import { CapabilityMeasurementEngine } from "./measurement/capability-measurement-engine.js";
import { ObservationEngine } from "../evolution/observation/observation-engine.js";
// A9 — pre-execution risk forecast + correlation wiring (CAP-12 carve-out:
// this file is the ONLY authorized composition-root wiring point for A9).
import { ProposalEventsAdapter } from "../evolution/a9/adapters/proposal-events-adapter.js";
import { MeasurementEventsAdapter } from "../evolution/a9/adapters/measurement-events-adapter.js";
import { EnrichedProposalsAdapter } from "../evolution/a9/adapters/enriched-proposals-adapter.js";
import { createEnrichedProposalsSource } from "../evolution/a9/adapters/enriched-proposals-source.js";
import { ForecastEngine } from "../evolution/a9/forecast-engine.js";
import { ForecastsStore } from "../evolution/a9/forecasts-store.js";
import { ForecastsAdapter } from "../evolution/a9/forecasts-adapter.js";
import { CorrelationsStore } from "../evolution/a9/correlations-store.js";
import { CorrelationsAdapter } from "../evolution/a9/correlations-adapter.js";
import { CorrelationEngine } from "../evolution/a9/correlation-engine.js";
import type { EnrichedProposal } from "../adaptation/intelligence-types.js";
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

  /** P5.5/P5.6 ruling #544 — READ-ONLY definition lookup, exposed so the
   *  operator CLI (`alix capability consolidate`) can resolve the
   *  operator-named `--definition=<id@version>`. Read-only by construction:
   *  the mutable `CapabilityCatalog` stays private (CAP-11 ruling #8), and
   *  this surface exposes `get` only. It resolves a name the OPERATOR gave —
   *  it never chooses a survivor, an absorbed set, or a definition. */
  readonly definitions: { get(id: string): CapabilityDefinition | undefined };

  /** CAP-10 — measurement engine instance (optional). Absent when the
   *  platform was constructed without `a5CapabilityMeasurement`
   *  (ruling #18). Exposed for tests + downstream wiring; service.measure()
   *  remains the public surface (CAP-8 ruling #2). */
  readonly measurementEngine?: CapabilityMeasurementEngine;

  /** A9 — pre-execution risk forecast + correlation wiring (additive; CAP-12
   *  carve-out). Read-only adapters over the platform's SAME EventLog
   *  (ruling #12) and the A9-owned governance JSONL stores, plus the two
   *  engines. A9 modules never instantiate EventLog / global infra
   *  themselves — the composition root does. Correlation stays automatic
   *  (never an operator mutation command). */
  readonly a9: {
    readonly proposalEvents: ProposalEventsAdapter;
    readonly measurementEvents: MeasurementEventsAdapter;
    readonly enrichedProposals: EnrichedProposalsAdapter;
    readonly forecasts: ForecastsAdapter;
    readonly correlations: CorrelationsAdapter;
    readonly forecastEngine: ForecastEngine;
    readonly correlationEngine: CorrelationEngine;
  };

  /** CapabilityPlatform constructor opts (locked ruling #12 — `eventLog`
   *  is REQUIRED; the platform never instantiates an EventLog internally).
   *  Production bootstrap (cli.ts / tui.ts) supplies the authoritative
   *  EventLog; existing platform tests MUST pass an explicit test
   *  EventLog fixture. The same instance flows through to the service. */
  constructor(opts: { catalogDir?: string; catalog?: CapabilityCatalog; eventLog: EventLog; proposalGenerator?: A7ProposalGenerator; a5CapabilityMeasurement?: A5CapabilityMeasurement; overlapSignalSource?: ProposalSignalSource; a9StoreDir?: string; a9EnrichedProposals?: ReadonlyArray<EnrichedProposal> }) {
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
    // CAP-10.5 ruling #R4 — composition root owns the sole
    // ProposalSignalChannel instance; injected into A5 (as signalSink)
    // and A7 (as signalSource). T8 sentinel verifies `new ProposalSignalChannel(`
    // appears exactly once in `src/`.
    const channel = new ProposalSignalChannel();
    const observationEngine = new ObservationEngine();
    // CAP-10 ruling #18 — compose A5 implementation into a measurement engine (optional).
    // When not supplied by the caller, the composition root constructs a real
    // A5CapabilityMeasurement bound to the channel.
    const a5 = opts.a5CapabilityMeasurement ?? new A5CapabilityMeasurement({
      observationEngine,
      signalSink: channel,
      catalog: this.catalog,
      eventLog: opts.eventLog,
    });
    let measurementEngine: CapabilityMeasurementEngine | undefined;
    if (a5) {
      measurementEngine = new CapabilityMeasurementEngine({
        catalog: this.catalog,
        a5,
        observationEngine,
      });
    }
    // P5.5/P5.6 pair layer (ruling #543) — composition-root option to
    // inject an `overlapSignalSource`. When absent, the composition root
    // constructs a default overlap source via `buildOverlapSignals` with a stub
    // `identitySupplier` that returns `null` for every overlap (no
    // signals emitted until the operator-CLI binding — ticket #309 /
    // ruling #544 — is wired). The pair layer is read-only over canonical
    // sources and emits evidence-only signals; it does NOT derive survivor
    // identity or absorbed set.
    const overlapSignalSource: ProposalSignalSource =
      opts.overlapSignalSource ??
      buildOverlapSignals({
        analyzer: new CapabilityOverlapAnalyzer(),
        inputs: async () => ({
          agentCards: [],
          proposals: [],
          capabilityEvents: [],
          registeredCapabilities: [],
        }),
        identitySupplier: () => null,
      });
    // A7 proposal generator — composition root constructs a real
    // A7ProposalGenerator bound to a composite signalSource (the A5
    // channel + the pair layer) when the caller does not supply one.
    // Existing test injects are preserved: `opts.proposalGenerator`
    // bypasses the wiring entirely.
    const proposalGenerator = opts.proposalGenerator ?? new A7ProposalGenerator({
      signalSource: compositeProposalSignalSource([channel, overlapSignalSource]),
    });
    this.service = new CapabilityService({
      catalog: this.catalog,
      resolver,
      mutationExecutor,
      eventLog: opts.eventLog,
      proposalGenerator,
      ...(measurementEngine !== undefined ? { measurementEngine } : {}),
    });
    this.measurementEngine = measurementEngine;
    // Read-only projection of the private catalog (ruling #544 wiring).
    const catalog = this.catalog;
    this.definitions = Object.freeze({
      get: (id: string): CapabilityDefinition | undefined => catalog.get(id),
    });

    // A9 — pre-execution risk forecast + correlation wiring (additive; CAP-12
    // carve-out, Phase 18). All read-only adapters are bound to the SAME
    // EventLog the platform received (ruling #12); stores are A9-owned under
    // the governance JSONL dir (default `.alix/governance`). Construction is
    // lazy — no I/O until the adapters/engines are called.
    const a9StoreDir = opts.a9StoreDir ?? join(process.cwd(), ".alix", "governance");
    const a9ProposalEvents = new ProposalEventsAdapter(opts.eventLog);
    const a9MeasurementEvents = new MeasurementEventsAdapter(opts.eventLog);
    // Real enriched-proposals source: when the caller doesn't inject one, derive
    // from the standard `.alix` adaptation stores lazily (P10.8a pipeline). A
    // supplier runs no I/O at construction — only when `.list()` is first
    // called — and a failed source yields [] (Phase 20). This keeps the
    // evidence-completeness detector live on the platform surface (review #377).
    const a9Enriched = new EnrichedProposalsAdapter(
      opts.a9EnrichedProposals ?? createEnrichedProposalsSource(process.cwd()),
    );
    const a9Forecasts = new ForecastsAdapter(new ForecastsStore(a9StoreDir));
    this.a9 = Object.freeze({
      proposalEvents: a9ProposalEvents,
      measurementEvents: a9MeasurementEvents,
      enrichedProposals: a9Enriched,
      forecasts: a9Forecasts,
      correlations: new CorrelationsAdapter(new CorrelationsStore(a9StoreDir)),
      forecastEngine: new ForecastEngine({
        proposalEvents: a9ProposalEvents,
        enrichedProposals: a9Enriched,
      }),
      correlationEngine: new CorrelationEngine({
        forecasts: a9Forecasts,
        proposalEvents: a9ProposalEvents,
        measurements: a9MeasurementEvents,
      }),
    });
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
