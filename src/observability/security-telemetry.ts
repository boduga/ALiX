/**
 * P4.3-Sa2 — Security Telemetry Adapter
 *
 * Typed wrapper around the MetricsStore for security-specific metrics.
 * Each method constructs labels internally -- callers never pass raw
 * label dictionaries.  All payloads are redacted before recording.
 *
 * Emission failure is non-fatal (logged but never thrown) so that
 * security monitoring cannot block the request path.
 *
 * @module
 */

import type { MetricRegistry } from "./metric-registry.js";
import type { MetricsStore, MetricRow } from "./metrics-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SecurityTelemetryOptions {
  registry: MetricRegistry;
  metricsStore: MetricsStore;
  /** Optional redaction function for payloads (default: identity). */
  redactPayload?: (value: unknown) => unknown;
}

// ---------------------------------------------------------------------------
// SecurityTelemetry
// ---------------------------------------------------------------------------

export class SecurityTelemetry {
  protected registry: MetricRegistry;
  protected store: MetricsStore;
  protected redact: (value: unknown) => unknown;

  constructor(opts: SecurityTelemetryOptions) {
    this.registry = opts.registry;
    this.store = opts.metricsStore;
    this.redact = opts.redactPayload ?? ((v: unknown) => v);
  }

  /** Record an authentication attempt. */
  authAttempt(result: "success" | "failure", method: "bearer" | "cookie" | "none"): void {
    this.emit("security_auth_attempt", { result, method });
  }

  /** Record an authorization denial. */
  authorizationDenied(permission: string, routeClass: string): void {
    this.emit("security_auth_denied", { permission, routeClass });
  }

  /** Record a rate-limited request rejection. */
  rateLimitRejected(routeClass: string, scope: "pre_auth" | "post_auth"): void {
    this.emit("security_rate_limited", { routeClass, scope });
  }

  /** Record a redaction event. */
  redaction(classification: string, sink: "response" | "sse" | "audit" | "log"): void {
    this.emit("security_redaction", { classification, sink });
  }

  /** Set the active SSE stream gauge. */
  sseActive(stream: "observability" | "session" | "audit", value: number): void {
    this.emit("security_sse_active", { stream }, value);
  }

  /** Record an audit log append. */
  auditAppend(result: "success" | "failure"): void {
    this.emit("security_audit_append", { result });
  }

  /** Record a config verification outcome. */
  configVerification(state: "valid" | "invalid" | "expired" | "unsigned"): void {
    this.emit("security_config_verified", { state });
  }

  /** Record a security gate evaluation and its duration. */
  securityGate(result: "pass" | "fail" | "warn", durationMs: number): void {
    this.emit("security_gate_result", { result });
    this.emit("security_gate_duration", { result }, durationMs);
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private pendingWrites: Array<Promise<void>> = [];

  /**
   * Emit a metric row to the store.
   *
   * - Redacts the payload before recording.
   * - Catches errors so emit failures never propagate.
   * - Default value is 1 (for counters).
   */
  protected emit(
    name: string,
    labels: Record<string, string>,
    value?: number,
  ): void {
    const def = this.registry.get(name);
    const resolvedValue = value ?? 1;

    // Redact labels through the redaction function
    const redactedLabels = this.redact({ ...labels }) as Record<string, string>;

    const row: MetricRow = {
      name,
      type: def?.type ?? "counter_delta",
      value: resolvedValue,
      timestamp: new Date().toISOString(),
      labels: redactedLabels,
    };

    this.safeAppend(row);
  }

  /** Append a row, catching and logging any error (fire-and-forget). */
  protected safeAppend(row: MetricRow): void {
    const promise = (async () => {
      try {
        for await (const _ of this.store.append(row)) {
          // drain the generator
        }
      } catch (err) {
        // Non-fatal: log and swallow
        console.error(`[SecurityTelemetry] failed to emit ${row.name}:`, err);
      }
    })();
    this.pendingWrites.push(promise);
    promise.finally(() => {
      const idx = this.pendingWrites.indexOf(promise);
      if (idx >= 0) this.pendingWrites.splice(idx, 1);
    });
  }

  /**
   * Wait for all pending writes to complete.
   * Used in tests; harmless in production.
   */
  async flush(): Promise<void> {
    await Promise.all(this.pendingWrites);
  }
}

// ---------------------------------------------------------------------------
// FakeSecurityTelemetry (for testing)
// ---------------------------------------------------------------------------

export class FakeSecurityTelemetry extends SecurityTelemetry {
  events: Array<{ method: string; args: unknown[] }> = [];

  private tracked(
    method: string,
    args: unknown[],
  ): void {
    this.events.push({ method, args });
  }

  override authAttempt(
    result: "success" | "failure",
    method: "bearer" | "cookie" | "none",
  ): void {
    this.tracked("authAttempt", [result, method]);
    super.authAttempt(result, method);
  }

  override authorizationDenied(permission: string, routeClass: string): void {
    this.tracked("authorizationDenied", [permission, routeClass]);
    super.authorizationDenied(permission, routeClass);
  }

  override rateLimitRejected(
    routeClass: string,
    scope: "pre_auth" | "post_auth",
  ): void {
    this.tracked("rateLimitRejected", [routeClass, scope]);
    super.rateLimitRejected(routeClass, scope);
  }

  override redaction(
    classification: string,
    sink: "response" | "sse" | "audit" | "log",
  ): void {
    this.tracked("redaction", [classification, sink]);
    super.redaction(classification, sink);
  }

  override sseActive(
    stream: "observability" | "session" | "audit",
    value: number,
  ): void {
    this.tracked("sseActive", [stream, value]);
    super.sseActive(stream, value);
  }

  override auditAppend(result: "success" | "failure"): void {
    this.tracked("auditAppend", [result]);
    super.auditAppend(result);
  }

  override configVerification(
    state: "valid" | "invalid" | "expired" | "unsigned",
  ): void {
    this.tracked("configVerification", [state]);
    super.configVerification(state);
  }

  override securityGate(result: "pass" | "fail" | "warn", durationMs: number): void {
    this.tracked("securityGate", [result, durationMs]);
    super.securityGate(result, durationMs);
  }
}
