// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A2.4 — Verification Report Builder.
 *
 * Constructs VerificationReport artifacts — the operational counterpart
 * to VerificationEvidence. Reports are for debugging, engineering analysis,
 * and investigation. They are NOT the primary governance object.
 *
 * @module verification-report
 */

import type {
  VerificationReport,
  MetricResult,
} from "../contracts/verification-contract.js";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// VerificationReportBuilder
// ---------------------------------------------------------------------------

/**
 * Builder for constructing VerificationReport artifacts incrementally
 * during a verification run.
 *
 * @invariant evidenceClass is always "projected" for A2-generated reports.
 */
export class VerificationReportBuilder {
  private readonly verificationId: string;
  private readonly reportId: string;
  private readonly replayMetadata: Record<string, unknown> = {};
  private readonly executionLogs: string[] = [];
  private readonly metricResults: MetricResult[] = [];
  private readonly diagnostics: Record<string, unknown>[] = [];

  constructor(verificationId: string, reportId?: string) {
    this.verificationId = verificationId;
    this.reportId = reportId ?? `rep-${randomUUID()}`;
  }

  /**
   * Add an execution log entry.
   */
  addExecutionLog(log: string): this {
    this.executionLogs.push(log);
    return this;
  }

  /**
   * Add a replay metadata key-value pair.
   */
  addReplayMetadata(key: string, value: unknown): this {
    this.replayMetadata[key] = value;
    return this;
  }

  /**
   * Add a metric comparison result.
   */
  addMetricResult(name: string, baselineValue: number, candidateValue: number): this {
    this.metricResults.push({
      name,
      baselineValue,
      candidateValue,
      delta: candidateValue - baselineValue,
    });
    return this;
  }

  /**
   * Add a diagnostic key-value pair.
   */
  addDiagnostic(diagnostic: Record<string, unknown>): this {
    this.diagnostics.push(diagnostic);
    return this;
  }

  /**
   * Build the immutable VerificationReport.
   */
  build(): VerificationReport {
    return {
      reportId: this.reportId,
      verificationId: this.verificationId,
      evidenceClass: "projected",
      replayMetadata: { ...this.replayMetadata },
      executionLogs: [...this.executionLogs],
      metricResults: [...this.metricResults],
      diagnostics: [...this.diagnostics],
    };
  }
}
