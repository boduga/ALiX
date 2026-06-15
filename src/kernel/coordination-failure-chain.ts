/**
 * coordination-failure-chain.ts — Build transitive failure chains from a coordination run.
 *
 * Finds root failure workers (failed/cancelled with no dependency_failed block reason),
 * then BFS-traverses the reverse dependency graph to find all downstream blocked workers.
 */

import type { CoordinationRun } from "./coordination-types.js";
import type { FailureChain } from "./coordination-result-types.js";

/**
 * Build failure chains for a coordination run.
 *
 * Returns one FailureChain per root failure worker, sorted deterministically
 * by the worker's array position in the run.
 */
export function buildFailureChains(run: CoordinationRun): FailureChain[] {
  // 1. Build reverse dependency graph: worker -> [dependents]
  const dependents = new Map<string, string[]>();
  for (const w of run.workers) {
    for (const dep of w.dependencies) {
      const list = dependents.get(dep) ?? [];
      list.push(w.id);
      dependents.set(dep, list);
    }
  }

  // 2. Find root failures -- workers that failed/cancelled and are NOT dependency-blocked
  const rootFailures = run.workers.filter(w =>
    (w.status === "failed" || w.status === "cancelled") &&
    w.blockReason !== "dependency_failed"
  );

  // 3. For each root failure, BFS to find all transitively affected workers
  const chains: FailureChain[] = [];
  for (const root of rootFailures) {
    const visited = new Set<string>();
    const queue: string[] = [];
    const depthByWorker: Record<string, number> = { [root.id]: 0 };

    // Seed with direct dependents
    const directDeps = dependents.get(root.id) ?? [];
    for (const dId of directDeps) {
      depthByWorker[dId] = 1;
      queue.push(dId);
    }

    // BFS to find all transitively blocked workers
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const currentDepth = depthByWorker[id] ?? 0;
      for (const dep of dependents.get(id) ?? []) {
        if (!visited.has(dep)) {
          depthByWorker[dep] = currentDepth + 1;
          queue.push(dep);
        }
      }
    }

    const allAffected = [...visited].sort();
    const directDependents = [...directDeps].sort();

    chains.push({
      rootWorkerId: root.id,
      rootTaskLabel: root.taskLabel,
      rootFailureKind: root.failureKind,
      rootError: root.error,
      directDependents,
      allAffectedWorkers: allAffected,
      depthByWorker,
    });
  }

  // 4. Sort chains deterministically by root worker's position in the workers array
  const orderByIndex = new Map(run.workers.map((w, i) => [w.id, i]));
  chains.sort((a, b) =>
    (orderByIndex.get(a.rootWorkerId) ?? 0) - (orderByIndex.get(b.rootWorkerId) ?? 0)
  );

  return chains;
}
