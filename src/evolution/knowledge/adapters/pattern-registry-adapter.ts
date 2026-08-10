// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A6 — Pattern registry adapter.
 *
 * Read-only projection of the in-memory PatternRegistry
 * (src/context/pattern-registry.ts) into the normalized
 * KnowledgeArtifact read model. The registry is memory-backed, so this
 * adapter touches no files: it enumerates the known TaskType values,
 * calls the public `getStats(taskType)` getter, and projects one
 * "Pattern" artifact per task type that has recorded stats. It never
 * calls `recordOutcome`/`save`/`clear` and never mutates the registry.
 *
 * Timestamp note: per-task-type stats carry no creation time, so the
 * projected artifact's `createdAt` is stamped with the projection
 * moment. Pattern stats reflect the registry's live aggregate state and
 * are re-projected fresh on every read, so they are never "stale by age".
 *
 * Artifact mapping (design spec §4.1):
 * - Pattern → subject: TaskType, content: native TaskTypeStats
 *
 * @module pattern-registry-adapter
 */

import type { PatternRegistry } from "../../../context/pattern-registry.js";
import type { TaskType } from "../../../task-classifier.js";
import type { KnowledgeArtifact } from "../contracts/curation-contract.js";
import { runAdapter, type AdapterResult } from "./shared.js";

/** The closed TaskType union — used to enumerate what getStats can return. */
const TASK_TYPES: readonly TaskType[] = [
  "bugfix",
  "feature",
  "refactor",
  "docs",
  "research",
  "unknown",
];

export class PatternRegistryAdapter {
  constructor(private readonly registry: PatternRegistry) {}

  async read(): Promise<AdapterResult> {
    // Single projection timestamp for all pattern artifacts (deterministic
    // within a read; stats carry no per-row creation time).
    return runAdapter("pattern_registry", async () => {
      const now = new Date().toISOString();
      const artifacts: KnowledgeArtifact[] = [];

      for (const taskType of TASK_TYPES) {
        const stats = this.registry.getStats(taskType);
        if (!stats) continue;
        // Guard the stats fields consumed into content — a partially-malformed
        // stats record must be skipped, never projected with "undefined".
        if (
          typeof stats.count !== "number" ||
          typeof stats.successRate !== "number" ||
          typeof stats.avgIterations !== "number" ||
          typeof stats.avgTokens !== "number"
        ) {
          continue;
        }
        artifacts.push({
          store: "pattern_registry",
          artifactId: `pattern:${taskType}`,
          artifactKind: "Pattern",
          subject: taskType,
          content: `${taskType}: ${stats.count} runs, successRate ${stats.successRate}, avgIterations ${stats.avgIterations}, avgTokens ${stats.avgTokens}`,
          createdAt: now,
          evidenceRefs: [],
          downstreamRefs: [],
        });
      }

      // An empty registry is still an available (empty) store.
      return artifacts;
    });
  }
}
