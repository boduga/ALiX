/**
 * telemetry-envelope.ts — P4.2a Unified Telemetry Envelope.
 *
 * Types, factory, normalization adapters, bounded buffer, and sink interface.
 *
 * Responsibilities:
 * 1. createTelemetryEnvelope() — build envelope from input (with validation)
 * 2. normalizeCanonicalEvent() — adapt existing CanonicalEvent
 * 3. normalizeTraceEvent() — adapt existing TraceEvent
 * 4. normalizeMetricEvent() — adapt MetricRow
 * 5. TelemetryBuffer — bounded in-memory accumulation
 * 6. TelemetrySink — interface for durable persistence
 *
 * Validation rules:
 * - eventType must be non-empty
 * - dimensions max 16 keys
 * - measurements values must be finite
 * - timestamp must be valid ISO 8601 or auto-assigned
 */

import { randomUUID } from "node:crypto";
import type { AlixEvent } from "../events/types.js";
import type { TraceEvent } from "../runtime/trace-events.js";

// ─── Types ────────────────────────────────────────────────────────────

export type TelemetryCategory =
  | "provider" | "tool" | "worker" | "coordination" | "approval"
  | "ownership" | "recovery" | "daemon" | "memory" | "cost";

export type TelemetrySeverity = "debug" | "info" | "warning" | "error" | "critical";

export interface TelemetryCorrelation {
  sessionId?: string;
  runId?: string;
  workerId?: string;
  taskId?: string;
  requestId?: string;
  approvalId?: string;
  traceId?: string;
  spanId?: string;
}

export interface TelemetryEnvelope {
  schemaVersion: "1.0";
  id: string;
  timestamp: string;
  category: TelemetryCategory;
  eventType: string;
  severity: TelemetrySeverity;
  correlation: TelemetryCorrelation;
  dimensions: Record<string, string | number | boolean>;
  measurements: Record<string, number>;
  payload?: Record<string, unknown>;
}

export interface TelemetryInput {
  sessionId: string;
  category: TelemetryCategory;
  eventType: string;
  severity: TelemetrySeverity;
  correlation?: Partial<TelemetryCorrelation>;
  dimensions?: Record<string, string | number | boolean>;
  measurements?: Record<string, number>;
  payload?: Record<string, unknown>;
}

export interface MetricInputType {
  name: string;
  type: "counter_delta" | "counter_total" | "gauge" | "histogram_sample";
  value: number;
  timestamp: string;
  labels?: Record<string, string>;
}

// ─── Validation ────────────────────────────────────────────────────────

const MAX_DIMENSION_KEYS = 16;

function validateInput(input: TelemetryInput): void {
  if (!input.eventType) throw new Error("eventType must be non-empty");
  if (input.dimensions && Object.keys(input.dimensions).length > MAX_DIMENSION_KEYS) {
    throw new Error(`dimensions exceed max of ${MAX_DIMENSION_KEYS} keys`);
  }
  if (input.measurements) {
    for (const [k, v] of Object.entries(input.measurements)) {
      if (typeof v !== "number" || !Number.isFinite(v)) {
        throw new Error(`measurement "${k}" must be a finite number, got ${v}`);
      }
    }
  }
}

export function createTelemetryEnvelope(input: TelemetryInput): TelemetryEnvelope {
  validateInput(input);
  return {
    schemaVersion: "1.0",
    id: `tel_${Date.now()}_${randomUUID().slice(0, 8)}`,
    timestamp: new Date().toISOString(),
    category: input.category,
    eventType: input.eventType,
    severity: input.severity,
    correlation: { sessionId: input.sessionId, ...input.correlation },
    dimensions: { ...input.dimensions },
    measurements: { ...input.measurements },
    payload: input.payload,
  };
}

// ─── Normalization ──────────────────────────────────────────────────────

// Map AlixEvent types to telemetry categories.
const CATEGORY_MAP: Record<string, TelemetryCategory> = {
  "tool.": "tool",
  "approval.": "approval",
  "policy.": "tool",
  "ownership.": "ownership",
  "coordination.": "coordination",
  "replay.": "recovery",
  "rollback.": "recovery",
  "recovery.": "recovery",
  "m09.": "memory",
  "model.": "cost",
  "daemon.": "daemon",
  "worker.": "worker",
  "session.": "daemon",
};

function inferCategory(eventType: string): TelemetryCategory {
  for (const [prefix, cat] of Object.entries(CATEGORY_MAP)) {
    if (eventType.startsWith(prefix)) return cat;
  }
  return "tool";
}

/**
 * Normalize an AlixEvent (EventLog event) into a TelemetryEnvelope.
 */
export function normalizeCanonicalEvent(event: AlixEvent): TelemetryEnvelope {
  return createTelemetryEnvelope({
    sessionId: event.sessionId,
    category: inferCategory(event.type),
    eventType: event.type,
    severity: "info",
    correlation: { traceId: event.meta?.traceId, spanId: event.meta?.spanId },
    dimensions: { actor: event.actor },
    payload: event.payload as Record<string, unknown> | undefined,
  });
}

/**
 * Normalize a TraceEvent into a TelemetryEnvelope.
 */
export function normalizeTraceEvent(event: TraceEvent): TelemetryEnvelope {
  return createTelemetryEnvelope({
    sessionId: event.sessionId ?? "",
    category: inferCategory(event.eventType),
    eventType: event.eventType,
    severity: event.status === "failed" ? "error" : "info",
    dimensions: { sourceType: event.sourceType },
    measurements: {},
    payload: event.rawEvent as Record<string, unknown> | undefined,
  });
}

/**
 * Normalize a MetricRow into a TelemetryEnvelope.
 * counter_delta → measurements.delta
 * counter_total → measurements.total
 * gauge → measurements.value
 * histogram_sample → measurements.sample (percentiles in payload)
 */
export function normalizeMetricEvent(event: MetricInputType): TelemetryEnvelope {
  const measurements: Record<string, number> = {};
  const payload: Record<string, unknown> = {};

  switch (event.type) {
    case "counter_delta":
      measurements.delta = event.value;
      break;
    case "counter_total":
      measurements.total = event.value;
      break;
    case "gauge":
      measurements.value = event.value;
      break;
    case "histogram_sample":
      measurements.sample = event.value;
      if (event.labels) {
        if (event.labels.p50) payload.p50 = parseFloat(event.labels.p50);
        if (event.labels.p95) payload.p95 = parseFloat(event.labels.p95);
        if (event.labels.p99) payload.p99 = parseFloat(event.labels.p99);
      }
      break;
  }

  return {
    schemaVersion: "1.0",
    id: `tel_${Date.now()}_${randomUUID().slice(0, 8)}`,
    timestamp: event.timestamp,
    category: "memory",
    eventType: `metric.${event.name}`,
    severity: "info",
    correlation: {},
    dimensions: { metricType: event.type, ...event.labels },
    measurements,
    payload: Object.keys(payload).length > 0 ? payload : undefined,
  };
}

// ─── Bounded Buffer ─────────────────────────────────────────────────────

export interface TelemetryBufferOptions {
  maxSize: number;
  overflow: "drop_oldest" | "error";
}

export class TelemetryBuffer {
  private buffer: TelemetryEnvelope[] = [];
  private readonly maxSize: number;
  private readonly overflow: "drop_oldest" | "error";

  constructor(opts: TelemetryBufferOptions) {
    this.maxSize = opts.maxSize;
    this.overflow = opts.overflow;
  }

  get size(): number {
    return this.buffer.length;
  }

  /**
   * Add an envelope. On overflow, drops oldest or throws based on config.
   */
  append(env: TelemetryEnvelope): void {
    if (this.buffer.length >= this.maxSize) {
      if (this.overflow === "error") {
        throw new Error(`TelemetryBuffer overflow (max ${this.maxSize})`);
      }
      this.buffer.shift(); // drop_oldest
    }
    this.buffer.push(env);
  }

  /**
   * Return all buffered envelopes and clear.
   */
  drain(): TelemetryEnvelope[] {
    const items = this.buffer;
    this.buffer = [];
    return items;
  }
}

// ─── Sink Interface ────────────────────────────────────────────────────

/**
 * Abstraction for durable telemetry persistence.
 * Implementations write to JSONL, forward to Inspector SSE, etc.
 */
export interface TelemetrySink {
  append(envelope: TelemetryEnvelope): Promise<void>;
}
