/**
 * P5.0c — WorkflowAnalyzer: detects stalls and backlog from workflow state.
 *
 * Reads active workflow entries from the WorkflowCoordinator and produces
 * observations when:
 * - Entries have been stuck in the same state for more than 24 hours (stall)
 * - Three or more entries accumulate in a bottleneck state (backlog)
 *
 * Bottleneck states monitored: BLOCKED, EXECUTING, UNDER_REVIEW.
 *
 * @module
 */

import type { Analyzer, AnalysisResult, Observation } from "./reflection-types.js";
import type { WorkflowStateEntry } from "../workflow/types.js";

// ---------------------------------------------------------------------------
// Dependency interface
// ---------------------------------------------------------------------------

/** The subset of WorkflowCoordinator that this analyzer reads from. */
export interface WorkflowStateReader {
  listActive(): Promise<WorkflowStateEntry[]>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Entries with no update in 24 hours are considered stalled. */
const STALL_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/** States that indicate a bottleneck when they accumulate entries. */
const BOTTLENECK_STATES = ["BLOCKED", "EXECUTING", "UNDER_REVIEW"] as const;

/** Minimum count for a backlog observation to be emitted. */
const BACKLOG_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// WorkflowAnalyzer
// ---------------------------------------------------------------------------

export class WorkflowAnalyzer implements Analyzer {
  readonly name = "WorkflowAnalyzer";

  private readonly coordinator: WorkflowStateReader;

  constructor(coordinator: WorkflowStateReader) {
    this.coordinator = coordinator;
  }

  /**
   * Analyze active workflow entries for stalls and backlogs.
   */
  async analyze(): Promise<AnalysisResult> {
    const entries = await this.coordinator.listActive();
    const observations: Observation[] = [];
    const now = Date.now();

    // Count per-state
    const stateCounts = new Map<string, number>();
    const stalled: string[] = [];

    for (const entry of entries) {
      stateCounts.set(entry.state, (stateCounts.get(entry.state) ?? 0) + 1);
      const age = now - new Date(entry.updatedAt).getTime();
      if (age > STALL_THRESHOLD_MS) {
        stalled.push(`#${entry.issueNumber}`);
      }
    }

    // Stall observation: entries stuck > 24 hours
    if (stalled.length > 0) {
      observations.push({
        type: "workflow_stall",
        severity: stalled.length >= 3 ? "high" : "medium",
        title: `${stalled.length} workflow(s) stalled for over 24 hours`,
        detail: `Issues: ${stalled.join(", ")}`,
        source: this.name,
        count: stalled.length,
      });
    }

    // Backlog observations: bottleneck states with >= threshold entries
    for (const state of BOTTLENECK_STATES) {
      const count = stateCounts.get(state) ?? 0;
      if (count >= BACKLOG_THRESHOLD) {
        observations.push({
          type: "workflow_stall",
          severity: "medium",
          title: `${count} workflow(s) in ${state}`,
          detail: `Accumulating in ${state} may indicate a bottleneck.`,
          source: this.name,
          count,
        });
      }
    }

    return { observations, recommendations: [] };
  }
}
