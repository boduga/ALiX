/**
 * A9 — Pre-Execution Risk Forecast contracts (Slice 1).
 *
 * A9 forecasts pre-execution risk for governance proposals. Slice 1 builds the
 * deterministic forecast pipeline: contracts + identity + risk band + 3
 * read-only adapters + 3 pure detectors + forecast builder + forecast engine.
 * Persistence, correlation, governance routing, and the CLI arrive in later
 * slices — Slice 1 produces NO persistence, NO A2.5 integration, NO CLI.
 *
 * Locked architectural invariants:
 *
 *   - Forecast layer is correlation-free. `A9Forecast` / `A9Correlation` MUST
 *     NOT carry `primary`, `correlationStatus`, or correlation semantics.
 *   - Q8 locked ruling: measurement events deliberately carry NO proposal
 *     linkage. `CapabilityMeasurementRecord` MUST NOT expose `proposalId`,
 *     `sourceProposalIds`, `forecastId`, or `correlationId`.
 *   - A9 adapters preserve RAW evidence. A9 does NOT consume A8's normalized
 *     aggregation layer (`src/evolution/learning/`); it is its own module.
 *
 * @module evolution/a9/contracts
 */

// ---------------------------------------------------------------------------
// Identity types
// ---------------------------------------------------------------------------

/** Content-addressed identity of an A9Forecast (SHA-256 hex of canonical content). */
export type ForecastId = string;

/** Content-addressed identity of an A9Correlation (SHA-256 hex of canonical content). */
export type CorrelationId = string;

// ---------------------------------------------------------------------------
// Forecast kind + risk band
// ---------------------------------------------------------------------------

/** The three locked A9 forecast kinds — one per pure detector. */
export type A9ForecastKind =
  | "trust-velocity"
  | "evidence-completeness"
  | "fingerprint-coincidence";

/** A6-locked risk band (thresholds in `risk-band.ts`):
 *  [0.0,0.3) low | [0.3,0.6) medium | [0.6,0.85) high | [0.85,1.0] critical. */
export type RiskBand = "low" | "medium" | "high" | "critical";

// ---------------------------------------------------------------------------
// A9Forecast — the forecast artifact
// ---------------------------------------------------------------------------

/**
 * A pre-execution risk forecast for a single governance proposal subject.
 *
 * Contract rules (locked): do NOT add `primary`, `correlationStatus`, or any
 * correlation semantics. The forecast layer is correlation-free — correlation
 * is a separate artifact (`A9Correlation`) built by a later slice.
 */
export interface A9Forecast {
  /** Content-addressed identity — SHA-256 hex of the canonical forecast
   *  content EXCLUDING `forecastId` itself and any persistence metadata. */
  readonly forecastId: ForecastId;
  /** Schema version of the forecast artifact. */
  readonly forecastVersion: string;
  /** The forecast subject — a governance proposal id (`proposalId`). */
  readonly subject: string;
  /** The capability the subject proposal targets (`capabilityId`). */
  readonly subjectCapability: string;

  readonly prediction: {
    /** Kind of the detection that determined the band (max internal score). */
    readonly kind: A9ForecastKind;
    /** Risk band projected from `internalScore` via the locked A6 thresholds. */
    readonly band: RiskBand;
    /** Maximum internal score across the subject's detector findings, in [0,1]. */
    readonly internalScore: number;
  };

  /** Validity window the forecast covers (used as a boundary by correlation). */
  readonly horizon: {
    readonly from: string;
    readonly to: string;
  };

  /** Weighted average of detector confidences, weighted by internalScore. */
  readonly confidence: number;

  readonly provenance: {
    /** ISO 8601 generation time. Identity-bearing content (documented). */
    readonly generatedAt: string;
    /** Version of the forecast generator/engine that produced this artifact. */
    readonly generatorVersion: string;
    /** Evidence references preserved from the detector findings. */
    readonly evidenceRefs: ReadonlyArray<string>;
  };
}

/** Canonical forecast content — `A9Forecast` without its content-addressed id.
 *  Identity canonicalization operates on this shape, so `forecastId` (and any
 *  future persistence metadata) is structurally excluded from identity. */
export type A9ForecastContent = Omit<A9Forecast, "forecastId">;

// ---------------------------------------------------------------------------
// A9Correlation — forecast ⇄ measurement linkage (later slice; contract now)
// ---------------------------------------------------------------------------

/**
 * A single forecast ⇄ measurement correlation pair (Slice 4+).
 *
 * Contract rules (locked): do NOT add `primary`, `terminal`, `resolved`,
 * `attempted`, or `correlationStatus`. One correlation per (forecastId,
 * measurementId) pair; no group artifact; no reverse pointer; no primary.
 */
export interface A9Correlation {
  /** Content-addressed identity of the correlation (canonical content, not JSONL position). */
  readonly correlationId: CorrelationId;
  /** Schema version of the correlation artifact. */
  readonly correlationVersion: string;

  readonly forecastId: ForecastId;
  readonly measurementId: string;

  /**
   * Foreign provenance of the correlation.
   *
   * `proposalId` is the correlated forecast's subject (the proposal the
   * forecast was generated for), NOT a measurement-carried proposal id — Q8
   * locked ruling: measurement events deliberately carry NO proposal linkage.
   * `notes` is reserved; the A9 v1 builder never populates it.
   */
  readonly foreignProvenance: {
    readonly proposalId?: string;
    readonly notes?: string;
  };

  readonly resolution: {
    /** Observed band from the measurement outcome. */
    readonly band: RiskBand;
    /** Band the forecast predicted. */
    readonly forecastBand: RiskBand;
    readonly delta: "match" | "under-forecast" | "over-forecast";
  };
}

/** Canonical correlation content — `A9Correlation` without its content-addressed id. */
export type A9CorrelationContent = Omit<A9Correlation, "correlationId">;

// ---------------------------------------------------------------------------
// Raw adapter records
// ---------------------------------------------------------------------------

/**
 * Proposal events adapter output — RAW governance proposal events.
 *
 * The `payload` is preserved verbatim. For `proposal.submitted` it is the
 * `ProposalSubmittedPayload` shape `{ candidate, signalIds, sourceVersion }`,
 * so the canonical two-hop bridge anchor `payload.candidate.target.id` remains
 * available downstream. A9 must NOT normalize the target away.
 */
export interface ProposalEventRecord {
  /** proposalId, read from `payload.proposalId` (ProposalStore writes
   *  `payload: { proposalId, ...payload }`; see proposal-store.ts:175-180). */
  readonly proposalId: string;
  /** capabilityId populated only for `proposal.submitted` (from
   *  payload.candidate.target.id); empty string for the other four kinds. */
  readonly capabilityId: string;
  readonly kind:
    | "proposal.submitted"
    | "proposal.approved"
    | "proposal.rejected"
    | "proposal.executed"
    | "proposal.execution_failed";
  /** RAW event payload, preserved verbatim (never normalized). */
  readonly payload: Record<string, unknown>;
  readonly recordedAt: string;
  /** EventLog seq rendered as string — used as an evidence reference. */
  readonly eventId: string;
}

/**
 * Measurement events adapter output — canonical measurement information ONLY.
 *
 * Q8 locked ruling: measurement events deliberately carry NO proposal linkage.
 * This record MUST NOT expose or invent `proposalId`, `sourceProposalIds`,
 * `forecastId`, or `correlationId`. Measurement consumption is a later-slice
 * (correlation) concern, never forecast generation.
 */
export interface CapabilityMeasurementRecord {
  /** Unique measurement identity — derived from the EventLog event `id` (UUID). */
  readonly measurementId: string;
  readonly capabilityId: string;
  readonly outcome: "effective" | "ineffective" | "inconclusive";
  readonly recordedAt: string;
  readonly eventId: string;
}

/**
 * Enriched proposals adapter output — read directly from raw `EnrichedProposal[]`.
 *
 * A9 reads `enrichedFields` directly and never imports A8's normalized
 * aggregation layer. The `assessment` flags + `sourceConfidence` +
 * `evidenceFingerprints` carry the population/recency/diversity signal the
 * evidence-completeness detector consumes.
 */
export interface EnrichedProposalRecord {
  readonly proposalId: string;
  /** "" when the proposal target is not capability-typed. */
  readonly capabilityId: string;
  /** Top-level key names of the source EnrichedProposal wrapper. */
  readonly enrichedFields: ReadonlyArray<string>;
  /** From proposal.createdAt (epoch ISO when nullish). */
  readonly recordedAt: string;
  /** proposal.sourceConfidence (finite in [0,1]; 0 when absent). */
  readonly sourceConfidence: number;
  /** proposal.evidenceFingerprints (string entries only). */
  readonly evidenceFingerprints: ReadonlyArray<string>;
  /** Which enriched fields are populated (non-null) on the source record. */
  readonly assessment: {
    readonly hasEffectivenessReport: boolean;
    readonly hasRevertDecision: boolean;
    readonly hasTimeToApproval: boolean;
    readonly hasTimeToApply: boolean;
  };
}

// ---------------------------------------------------------------------------
// Detector output — a single detection-worthy finding
// ---------------------------------------------------------------------------

/** Output of a pure A9 detector. Deterministic given the same input + timestamp. */
export interface DetectorFinding {
  /** Forecast subject — a proposal id. */
  readonly subject: string;
  /** Capability the subject proposal targets. */
  readonly subjectCapability: string;
  readonly kind: A9ForecastKind;
  /** Internal risk score in [0,1] (drives band projection). */
  readonly internalScore: number;
  /** Detector confidence in [0,1]. */
  readonly confidence: number;
  /** Evidence references preserved for auditability. */
  readonly evidenceRefs: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Read-only adapter contract
// ---------------------------------------------------------------------------

/** A9 read-only adapter. Never writes; joins belong above the adapter boundary. */
export interface A9Adapter<T> {
  readonly name: string;
  list(): Promise<ReadonlyArray<T>>;
}

// ---------------------------------------------------------------------------
// Version constants
// ---------------------------------------------------------------------------

/** Forecast artifact schema version. */
export const A9_FORECAST_VERSION = "1.0.0";

/** Correlation artifact schema version. */
export const A9_CORRELATION_VERSION = "1.0.0";

/** Forecast generator/engine version (provenance.generatorVersion). */
export const A9_GENERATOR_VERSION = "1.0.0";

/** Default forecast validity horizon in days (horizon = [generatedAt, +N days]). */
export const A9_FORECAST_HORIZON_DAYS = 30;
