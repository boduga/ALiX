/**
 * Self-driven evolution projection (Q-S1..S4, Q-C1..C3, Q-C4).
 *
 * The collector is projection-blind: it dispatches session-filtered events via
 * updateAll and relays newly-read sessionless events (sessionId "") via the
 * optional sessionlessEvents callback (Q-C4). This projection consumes ONLY the
 * relayed sessionless stream — governance proposal + measurement events — and
 * reads its persisted sources (forecasts/correlations/recommendations JSONL)
 * fresh each snapshot cycle (Q-C3a). A8 learning recompute is change-gated on
 * newly observed A8-relevant events (Q-C2). All accumulated sessionless
 * evidence is durable via exportState/importState so restart never re-applies
 * or loses relayed events (dedup by event.seq in seenSeqs).
 *
 * Core invariant: the snapshot is an association/read model over canonical
 * artifacts — never a new domain store.
 *
 * Durable-builder note: this class intentionally does NOT write
 * `implements DurableProjectionBuilder<EvolutionProjectionSnapshot>`. The base
 * contract declares a synchronous `snapshot()`, while this projection is
 * I/O-backed (fresh JSONL reads + an async A8 learn), so its `snapshot()` is
 * async. ProjectionRuntime accommodates this: `snapshotOfAsync` awaits a
 * Promise-valued snapshot, and the heterogeneous registry types builders as
 * `ProjectionBuilder<unknown>` — where `Promise<EvolutionProjectionSnapshot>`
 * is assignable to `unknown` — so this class registers with no cast. It remains
 * structurally a durable builder (update/snapshot/reset + exportState/importState
 * round-trip), and `isDurable` detects it by the presence of both state methods.
 */
import type { AlixEvent } from '../../../events/types.js';
import type { LifecycleState } from '../../../adaptation/capability-evolution-types.js';
import type { EvolutionProjectionSnapshot } from './evolution-projection-snapshot.js';
import { assembleEvolutionSnapshot, type MeasurementRecord } from './evolution-snapshot-assembler.js';
import type { CapabilityMeasurementPayload } from '../../../capability/measurement/measurement-event-types.js';
import type { ProposalSubmittedPayload } from '../../../capability/governance/governance-types.js';
import { readCandidateTargetId } from '../../../evolution/a9/bridge-target.js';
import type { LearningProposal } from '../../../evolution/learning/contracts/learning-contract.js';
import type { A9Correlation, A9Forecast } from '../../../evolution/a9/contracts/a9-contract.js';
import type { GovernanceRecommendation } from '../../../evolution/verification/contracts/recommendation-contract.js';

/** Fresh-read persisted sources, re-read every snapshot cycle (Q-C3a).
 *  forecast/correlation/recommendation sources are typed to their CONCRETE
 *  canonical contracts (not `unknown`) so the assembler's typed StageInputs are
 *  satisfied structurally — the projection stays decoupled from HOW each source
 *  persists (JSONL-backed adapters in the composition root). */
export interface EvolutionReadSources {
  readonly lifecycle: () => ReadonlyArray<{ capabilityId: string; state: LifecycleState; eligible: boolean }>;
  readonly forecasts: () => Promise<ReadonlyArray<A9Forecast>>;
  readonly correlations: () => Promise<ReadonlyArray<A9Correlation>>;
  readonly recommendations: () => Promise<ReadonlyArray<GovernanceRecommendation>>;
  readonly learning: { learn(now: string): Promise<LearningProposal | null> };
}

export interface EvolutionProjectionOptions {
  readonly sources: EvolutionReadSources;
  /** Deterministic cycle clock (Q-S3 — collector timestamp, not UI clock). */
  readonly clock?: () => number;
}

export interface EvolutionProjectionState {
  /** String(event.seq) → true. Exact dedup marker for relayed sessionless
   *  events (Q-C4) — restart-safe because it is persisted. */
  readonly seenSeqs: Record<string, true>;
  readonly measurements: readonly MeasurementRecord[];
  readonly proposalTargets: Record<string, string>;
  readonly a8: {
    readonly pending: boolean;
    readonly unavailable: boolean;
    readonly lastSuccessful: LearningProposal | null;
  };
}

/** The exported state is read-only; the builder replaces whole top-level
 *  fields (measurements/a8) as it ingests, so the private field uses this
 *  write-visible variant. Export remains `EvolutionProjectionState`. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const MEASUREMENT_EVENT = 'capability.governance.measurement.measured';
const PROPOSAL_SUBMITTED = 'capability.governance.proposal.submitted';
const PROPOSAL_PREFIX = 'capability.governance.proposal.';

function isA8Relevant(type: string): boolean {
  return type.startsWith(PROPOSAL_PREFIX) || type === MEASUREMENT_EVENT;
}

export class EvolutionProjection {
  private state: Mutable<EvolutionProjectionState> = this.initialState();
  private relayObserved = false;
  private readonly sources: EvolutionReadSources;
  private readonly clock: () => number;

  constructor(opts: EvolutionProjectionOptions) {
    this.sources = opts.sources;
    this.clock = opts.clock ?? (() => Date.now());
  }

  private initialState(): Mutable<EvolutionProjectionState> {
    return {
      seenSeqs: {},
      measurements: [],
      proposalTargets: {},
      a8: { pending: false, unavailable: false, lastSuccessful: null },
    };
  }

  /** Session-filtered projection batch — the evolution projection consumes NO
   *  session-scoped events (governance/measurement events are sessionless).
   *  Deliberately a no-op: its input is the sessionless relay. */
  update(_events: readonly AlixEvent[]): void {}

  /** Q-C4 — ingest the relayed sessionless events (ONLY newly-read, per cycle).
   *  Dedupes by event.seq against persisted seenSeqs. The relay delivers ANY
   *  non-session-matching event (not strictly `sessionId === ""`), so `ingest`
   *  type-filters to the `capability.governance.*` families — anything else is
   *  ignored (never relied on the relay to have pre-filtered). */
  ingestSessionless(events: readonly AlixEvent[]): void {
    this.relayObserved = true;
    for (const e of events) {
      if (typeof e.seq !== 'number') continue;
      const key = String(e.seq);
      if (this.state.seenSeqs[key]) continue;
      this.state.seenSeqs[key] = true;
      this.ingest(e);
    }
  }

  private ingest(e: AlixEvent): void {
    const type = e.type;
    if (type === MEASUREMENT_EVENT) {
      const p = e.payload as CapabilityMeasurementPayload;
      this.state.measurements = [
        ...this.state.measurements,
        {
          measurementId: e.id ?? String(e.seq),
          eventId: String(e.seq),
          capabilityId: p.measurement.capabilityId,
          recordedAt: e.timestamp,
          status: p.post.status,
          outcomeKind: p.outcome.kind,
          confidence: p.post.confidence,
        },
      ];
      this.state.a8 = { ...this.state.a8, pending: true };
    } else if (type === PROPOSAL_SUBMITTED) {
      // Named typed payload (CONTRIBUTING: events use typed payloads). The
      // raw EventLog event carries `proposalId` at the payload top level
      // (proposal-store.append spreads `{ proposalId, ...payload }`), so the
      // canonical ProposalSubmittedPayload is extended with the optional id.
      const p = e.payload as ProposalSubmittedPayload & { readonly proposalId?: unknown };
      const target = readCandidateTargetId(p as unknown as Readonly<Record<string, unknown>>);
      const proposalId = typeof p.proposalId === 'string' ? p.proposalId : undefined;
      if (target && proposalId) this.state.proposalTargets[proposalId] = target;
      this.state.a8 = { ...this.state.a8, pending: true };
    } else if (isA8Relevant(type)) {
      this.state.a8 = { ...this.state.a8, pending: true };
    }
  }

  /** Assemble ONE immutable snapshot at the collector-cycle observation point.
   *  NEVER throws — a failed source becomes an unavailable stage (Q-C3b). */
  async snapshot(): Promise<EvolutionProjectionSnapshot> {
    const generatedAt = this.clock();
    let learningResult = this.state.a8.lastSuccessful;
    let learningUnavailable = this.state.a8.unavailable;
    if (this.state.a8.pending) {
      try {
        const result = await this.sources.learning.learn(new Date(generatedAt).toISOString());
        this.state.a8 = { pending: false, unavailable: false, lastSuccessful: result };
        learningResult = result;
        learningUnavailable = false;
      } catch {
        // Q-C2 — relevant change + failure ⇒ unavailable (never empty).
        // lastSuccessful is retained (not wiped) for a later successful restore.
        this.state.a8 = { ...this.state.a8, pending: false, unavailable: true };
        learningUnavailable = true;
      }
    }

    const [forecasts, correlations, recommendations] = await Promise.all([
      this.readStage(this.sources.forecasts),
      this.readStage(this.sources.correlations),
      this.readStage(this.sources.recommendations),
    ]);
    const lifecycle = await this.readStage(() =>
      this.sources.lifecycle().map((l) => ({ capabilityId: l.capabilityId, state: l.state, eligible: l.eligible })),
    );

    return assembleEvolutionSnapshot({
      generatedAt,
      lifecycle,
      learning: { result: learningResult, unavailable: learningUnavailable },
      forecasts,
      correlations,
      recommendations,
      measurements: {
        records: this.state.measurements,
        status: !this.relayObserved
          ? 'unavailable'
          : this.state.measurements.length > 0
            ? 'available'
            : 'empty',
      },
      proposalTargets: this.state.proposalTargets,
    });
  }

  /** Read one stage's records with a Q-C3b status: `available` / `empty` from
   *  record count, `unavailable` when the source throws (a failed read degrades
   *  the stage instead of rejecting snapshot()). Accepts a sync OR async
   *  source — the bare lifecycle reader and the Promise-based JSONL readers
   *  share this one path (no readStage/readStageSync twin). */
  private async readStage<T>(read: () => ReadonlyArray<T> | Promise<ReadonlyArray<T>>) {
    try {
      const records = await read();
      return { records, status: records.length > 0 ? ('available' as const) : ('empty' as const) };
    } catch {
      return { records: [] as ReadonlyArray<T>, status: 'unavailable' as const };
    }
  }

  reset(): void {
    this.state = this.initialState();
    this.relayObserved = false;
  }

  exportState(): EvolutionProjectionState {
    return this.state;
  }

  importState(state: EvolutionProjectionState): void {
    this.state = {
      seenSeqs: { ...state.seenSeqs },
      measurements: [...state.measurements],
      proposalTargets: { ...state.proposalTargets },
      a8: { ...state.a8, lastSuccessful: state.a8.lastSuccessful },
    };
  }
}
