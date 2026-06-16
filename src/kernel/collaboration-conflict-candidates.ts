/**
 * collaboration-conflict-candidates.ts — Bounded candidate pair generation for conflict detection.
 *
 * Only active current-attempt findings are eligible. Groups by topic key.
 * Generates unique sorted pairs within each group. Caps are enforced.
 */

import { createHash } from "node:crypto";
import type { CoordinationRun, WorkerAssignment } from "./coordination-types.js";
import type { SharedFinding } from "./collaboration-types.js";
import type { FindingClaim } from "./collaboration-conflict-types.js";
import { computeFindingStatus } from "./collaboration-freshness.js";

export type CandidateLimits = {
  maxFindingsPerTopic: number;
  maxPairsPerDetectionPass: number;
};

export const DEFAULT_CANDIDATE_LIMITS: CandidateLimits = {
  maxFindingsPerTopic: 20,
  maxPairsPerDetectionPass: 200,
};

export type CandidateGenerationReport = {
  totalActive: number;
  totalPairs: number;
  omittedPairs: number;
  groups: number;
  warnings: string[];
};

export class ConflictCandidateGenerator {
  constructor(private limits: CandidateLimits = DEFAULT_CANDIDATE_LIMITS) {}

  generateCandidates(
    findings: SharedFinding[],
    run: CoordinationRun,
  ): { pairs: Array<{ left: SharedFinding; right: SharedFinding }>; report: CandidateGenerationReport } {
    // Filter to active findings with real source-attempt checks
    const active = findings.filter(f => {
      const sourceWorker = run.workers.find(w => w.id === f.workerId);
      const attempt = sourceWorker?.attempt ?? 1;
      const status = computeFindingStatus(f, attempt);
      return status === "active";
    });

    // Group by topic key (from claim if available)
    const groups = new Map<string, SharedFinding[]>();
    const ungrouped: SharedFinding[] = [];
    for (const f of active) {
      if (f.claim) {
        const key = createHash("sha256").update(JSON.stringify({ subject: f.claim.normalizedSubject, predicate: f.claim.normalizedPredicate, scope: f.claim.scope ?? "" })).digest("hex");
        const list = groups.get(key) ?? [];
        if (list.length < this.limits.maxFindingsPerTopic) list.push(f);
        groups.set(key, list);
      } else {
        ungrouped.push(f);
      }
    }

    // Generate pairs within each group
    const pairs: Array<{ left: SharedFinding; right: SharedFinding }> = [];
    const warnings: string[] = [];
    let omittedPairs = 0;

    for (const [, group] of groups) {
      // Sort deterministically
      group.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.workerId.localeCompare(b.workerId) || a.id.localeCompare(b.id));
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          if (pairs.length >= this.limits.maxPairsPerDetectionPass) {
            omittedPairs++;
            continue;
          }
          pairs.push({ left: group[i], right: group[j] });
        }
      }
    }

    return {
      pairs,
      report: { totalActive: active.length, totalPairs: pairs.length, omittedPairs, groups: groups.size, warnings },
    };
  }
}
