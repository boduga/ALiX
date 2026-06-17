/**
 * replan-simulator.ts — Graph simulation for model-proposed replan drafts.
 *
 * Builds a SimulatedGraph from a PlanRevisionDraft + existing workers:
 * - Maps draftWorkerIds to deterministic provisional durable IDs
 * - Detects graph-level errors (cycles, unknown refs, dangling deps, etc.)
 * - Applies automatic dependency rewiring for replaced workers
 * - Produces the exact idMap consumed by the CAS applier
 *
 * All imports use .js extensions (NodeNext).
 */

import { createHash } from "node:crypto";
import type { WorkerAssignment } from "./coordination-types.js";
import type {
  DependencyRewire,
  PlanRevisionDraft,
  SimulatedGraph,
  SimulatedWorker,
  ValidationError,
  ValidationWarning,
} from "./replan-types.js";

export interface ReplanSimulatorOptions {
  /** Maximum number of workers allowed in the simulated graph (default: 50). */
  maxWorkers?: number;
}

/**
 * ReplanSimulator builds and validates a proposed worker graph from a draft.
 *
 * The simulator:
 * 1. Assigns deterministic provisional durable IDs to every draftWorkerId
 * 2. Detects structural errors that span the combined existing+draft graph
 * 3. Applies automatic dependency rewiring when a worker is replaced
 * 4. Returns a SimulatedGraph with the idMap the applier needs
 */
export class ReplanSimulator {
  /**
   * Simulate applying a PlanRevisionDraft to the current worker graph.
   *
   * @param draft — The validated (or unvalidated) draft to simulate.
   * @param existingWorkers — Current set of WorkerAssignments.
   * @param options — Optional configuration (maxWorkers, etc.).
   * @returns A SimulatedGraph with the proposed graph state.
   */
  static simulate(
    draft: PlanRevisionDraft,
    existingWorkers: WorkerAssignment[],
    options?: ReplanSimulatorOptions,
  ): SimulatedGraph {
    const maxWorkers = options?.maxWorkers ?? 50;
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    const existingIds = new Set(existingWorkers.map((w) => w.id));

    // ── 1. Collect draft worker entries ────────────────────────────────

    interface DraftEntry {
      id: string;
      deps: string[];
      taskLabel: string;
      source: "add" | "replace";
    }

    const draftEntries: DraftEntry[] = [];
    for (const w of draft.workersToAdd) {
      draftEntries.push({
        id: w.draftWorkerId,
        deps: w.dependencies,
        taskLabel: w.taskLabel,
        source: "add",
      });
    }
    for (const rs of draft.workersToReplace) {
      draftEntries.push({
        id: rs.replacement.draftWorkerId,
        deps: rs.replacement.dependencies,
        taskLabel: rs.replacement.taskLabel,
        source: "replace",
      });
    }

    // ── 2. Build deterministic idMap ───────────────────────────────────

    const idMap: Record<string, string> = {};
    for (const entry of draftEntries) {
      const hash = createHash("sha256").update(entry.id).digest("hex");
      idMap[entry.id] = `draft_${hash.substring(0, 12)}`;
    }

    const provisionalIdSet = new Set(Object.values(idMap));

    // ── 3. Check duplicate draft IDs ───────────────────────────────────

    const seenDraftIds = new Set<string>();
    for (const entry of draftEntries) {
      if (seenDraftIds.has(entry.id)) {
        errors.push({
          field: "draftWorkerId",
          message: `Duplicate draftWorkerId: "${entry.id}"`,
          code: "duplicate_draft_id",
        });
      }
      seenDraftIds.add(entry.id);
    }

    // ── 4. Check unknown refs, self-deps, duplicate deps in drafts ─────

    const allKnownIds = new Set([...existingIds, ...provisionalIdSet]);

    for (const entry of draftEntries) {
      const effectiveId = idMap[entry.id];
      const seenDepTargets = new Set<string>();

      for (const dep of entry.deps) {
        // Resolve: existing IDs stay, draft IDs map through idMap
        const resolvedId = existingIds.has(dep) ? dep : idMap[dep];

        if (!resolvedId || !allKnownIds.has(resolvedId)) {
          errors.push({
            field: entry.source === "add" ? "workersToAdd" : "workersToReplace",
            message: `Unknown dependency reference "${dep}" in "${entry.id}"`,
            code: "unknown_reference",
          });
          continue;
        }

        if (resolvedId === effectiveId) {
          errors.push({
            field: entry.source === "add" ? "workersToAdd" : "workersToReplace",
            message: `Self-dependency in worker "${entry.id}"`,
            code: "self_dependency",
          });
        }

        if (seenDepTargets.has(resolvedId)) {
          errors.push({
            field: entry.source === "add" ? "workersToAdd" : "workersToReplace",
            message: `Duplicate dependency "${dep}" in worker "${entry.id}"`,
            code: "duplicate_dependency",
          });
        }
        seenDepTargets.add(resolvedId);
      }
    }

    // ── 5. Validate dependencyRewiring references ──────────────────────

    for (const rw of draft.dependencyRewiring) {
      // dependentWorkerRef must exist in the combined graph
      const dependentId = existingIds.has(rw.dependentWorkerRef)
        ? rw.dependentWorkerRef
        : idMap[rw.dependentWorkerRef];
      if (!dependentId || !allKnownIds.has(dependentId)) {
        errors.push({
          field: "dependencyRewiring",
          message: `Unknown dependentWorkerRef "${rw.dependentWorkerRef}" in dependency rewiring`,
          code: "unknown_reference",
        });
      }

      // removeDependencyRef must exist in the combined graph
      if (rw.removeDependencyRef) {
        const removeId = existingIds.has(rw.removeDependencyRef)
          ? rw.removeDependencyRef
          : idMap[rw.removeDependencyRef];
        if (!removeId || !allKnownIds.has(removeId)) {
          errors.push({
            field: "dependencyRewiring",
            message: `Unknown removeDependencyRef "${rw.removeDependencyRef}" in dependency rewiring`,
            code: "unknown_reference",
          });
        }
      }

      // addDependencyRef must exist in the combined graph.
      // Empty string means "just remove, don't add anything".
      if (rw.addDependencyRef) {
        const addId = existingIds.has(rw.addDependencyRef)
          ? rw.addDependencyRef
          : idMap[rw.addDependencyRef];
        if (!addId || !allKnownIds.has(addId)) {
          errors.push({
            field: "dependencyRewiring",
            message: `Unknown addDependencyRef "${rw.addDependencyRef}" in dependency rewiring`,
            code: "unknown_reference",
          });
        }
      }
    }

    // ── 6. Check incompatible operations ──────────────────────────────

    const replaceTargets = new Set(draft.workersToReplace.map((rs) => rs.targetWorkerId));
    const cancelSet = new Set(draft.workersToCancel);
    const modifyTargets = new Set(draft.workersToModify.map((m) => m.workerId));

    for (const id of replaceTargets) {
      if (modifyTargets.has(id)) {
        errors.push({
          field: "workersToReplace",
          message: `Worker "${id}" is both replaced and modified`,
          code: "incompatible_ops",
        });
      }
      if (cancelSet.has(id)) {
        errors.push({
          field: "workersToReplace",
          message: `Worker "${id}" is both replaced and cancelled`,
          code: "incompatible_ops",
        });
      }
    }

    for (const id of modifyTargets) {
      if (cancelSet.has(id)) {
        errors.push({
          field: "workersToModify",
          message: `Worker "${id}" is both modified and cancelled`,
          code: "incompatible_ops",
        });
      }
    }

    // ── 7. Check dangling deps after cancellation ──────────────────────

    // For each existing worker that is cancelled, check if any other
    // existing worker that is NOT removed depends on it.
    // Account for modifications that may remove the problematic dep.
    const modifyDepRemovals = new Map<string, Set<string>>();
    for (const m of draft.workersToModify) {
      if (m.dependencies !== undefined) {
        // The modification specifies an explicit dependency list.
        // We can't know which deps were removed without the original list,
        // but we know the dep will be replaced with the new list.
        // For the dangling check, we conservatively skip the check when
        // the worker is being modified (the new deps will be applied later).
        modifyDepRemovals.set(m.workerId, new Set(m.dependencies));
      }
    }

    for (const cancelledId of cancelSet) {
      if (!existingIds.has(cancelledId)) continue;

      for (const w of existingWorkers) {
        if (w.id === cancelledId) continue;
        if (cancelSet.has(w.id) || replaceTargets.has(w.id)) continue;

        if (w.dependencies.includes(cancelledId)) {
          // If the worker is being modified, its new deps might not include
          // the cancelled dependency. Check the modification list.
          const newDeps = modifyDepRemovals.get(w.id);
          if (newDeps !== undefined && !newDeps.has(cancelledId)) {
            // Modification will remove this dependency — not dangling
            continue;
          }

          errors.push({
            field: "workersToCancel",
            message: `Cancelling "${cancelledId}" leaves dangling dependency in worker "${w.id}"`,
            code: "dangling_dependency",
          });
        }
      }
    }

    // ── 8. Check excessive expansion ───────────────────────────────────

    const totalWorkers =
      existingWorkers.length -
      cancelSet.size +
      draft.workersToAdd.length;

    if (totalWorkers > maxWorkers) {
      errors.push({
        field: "workers",
        message: `Graph expansion exceeds limit of ${maxWorkers} (would have ${totalWorkers} workers)`,
        code: "excessive_expansion",
      });
    }

    // ── 9. Build simulated workers ─────────────────────────────────────

    const workers: SimulatedWorker[] = [];

    // Existing workers: keep, cancel, or replace
    const replaceMap = new Map(
      draft.workersToReplace.map((rs) => [rs.targetWorkerId, rs]),
    );

    for (const w of existingWorkers) {
      if (replaceMap.has(w.id)) {
        // Old worker is removed
        workers.push({
          id: w.id,
          taskLabel: w.taskLabel,
          dependencies: [...w.dependencies],
          status: "removed",
        });

        // Add replacement
        const rs = replaceMap.get(w.id)!;
        workers.push({
          id: idMap[rs.replacement.draftWorkerId],
          draftWorkerId: rs.replacement.draftWorkerId,
          taskLabel: rs.replacement.taskLabel,
          dependencies: rs.replacement.dependencies.map((dep) =>
            existingIds.has(dep) ? dep : (idMap[dep] ?? dep),
          ),
          status: "replacement",
        });
      } else if (cancelSet.has(w.id)) {
        workers.push({
          id: w.id,
          taskLabel: w.taskLabel,
          dependencies: [...w.dependencies],
          status: "removed",
        });
      } else {
        workers.push({
          id: w.id,
          taskLabel: w.taskLabel,
          dependencies: [...w.dependencies],
          status: "existing",
        });
      }
    }

    // Add draft workers (workersToAdd) — these are brand-new workers.
    // Dependencies referencing draftWorkerIds are resolved to provisional IDs.
    for (const w of draft.workersToAdd) {
      workers.push({
        id: idMap[w.draftWorkerId],
        draftWorkerId: w.draftWorkerId,
        taskLabel: w.taskLabel,
        dependencies: w.dependencies.map((dep) =>
          existingIds.has(dep) ? dep : (idMap[dep] ?? dep),
        ),
        status: "draft",
      });
    }

    // ── 10. Apply modifications ────────────────────────────────────────

    const modifyMap = new Map(
      draft.workersToModify.map((m) => [m.workerId, m]),
    );

    for (const w of workers) {
      const mod = modifyMap.get(w.id);
      if (mod) {
        if (mod.dependencies !== undefined) {
          w.dependencies = mod.dependencies.map((dep) =>
            existingIds.has(dep) ? dep : (idMap[dep] ?? dep),
          );
        }
        // If the worker wasn't already "removed", update its status
        if (w.status !== "removed") {
          w.status = "modified";
        }
      }
    }

    // ── 11. Build set of explicit override edges for auto-rewire ───────

    // Edges represented as "dependentWorkerRef:removeDependencyRef"
    // dependentWorkerRef is resolved through idMap so that overrides
    // referencing a draftWorkerId match the auto-rewire lookup key
    // (which uses the resolved provisional durable ID).
    const explicitOverrideEdges = new Set<string>();
    for (const rw of draft.dependencyRewiring) {
      const resolvedDependent = existingIds.has(rw.dependentWorkerRef)
        ? rw.dependentWorkerRef
        : (idMap[rw.dependentWorkerRef] ?? rw.dependentWorkerRef);
      explicitOverrideEdges.add(`${resolvedDependent}:${rw.removeDependencyRef}`);
    }

    // ── 12. Apply explicit dependency rewiring ─────────────────────────

    for (const rw of draft.dependencyRewiring) {
      const targetWorker = this.resolveWorker(
        rw.dependentWorkerRef,
        workers,
        existingIds,
        idMap,
      );
      if (targetWorker) {
        targetWorker.dependencies = targetWorker.dependencies.filter(
          (d) => d !== rw.removeDependencyRef,
        );
        const addId = existingIds.has(rw.addDependencyRef)
          ? rw.addDependencyRef
          : idMap[rw.addDependencyRef];
        if (addId && !targetWorker.dependencies.includes(addId)) {
          targetWorker.dependencies.push(addId);
        }
      }
    }

    // ── 13. Apply automatic dependency rewiring for replaced workers ───

    for (const rs of draft.workersToReplace) {
      const oldId = rs.targetWorkerId;
      const newId = idMap[rs.replacement.draftWorkerId];
      if (!newId) continue;

      for (const w of workers) {
        if (w.status === "removed") continue;
        if (w.id === oldId || w.id === newId) continue;

        const depIdx = w.dependencies.indexOf(oldId);
        if (depIdx === -1) continue;

        // Check for explicit override
        const edgeKey = `${w.id}:${oldId}`;
        if (explicitOverrideEdges.has(edgeKey)) continue;

        w.dependencies[depIdx] = newId;
      }
    }

    // ── 14. Build edges ────────────────────────────────────────────────

    const edges: Array<{ from: string; to: string }> = [];
    for (const w of workers) {
      if (w.status === "removed") continue;
      for (const dep of w.dependencies) {
        // Edge direction: from dependency → to dependent
        edges.push({ from: dep, to: w.id });
      }
    }

    // ── 15. Detect cycles ──────────────────────────────────────────────

    const activeWorkers = workers.filter((w) => w.status !== "removed");
    const adjacency = new Map<string, string[]>();
    for (const w of activeWorkers) {
      adjacency.set(w.id, w.dependencies);
    }

    const cycle = this.detectCycle(adjacency);
    if (cycle) {
      errors.push({
        field: "dependencyGraph",
        message: `Cycle detected: ${cycle.join(" → ")}`,
        code: "cycle_detected",
      });
    }

    // ── 16. Check dangling deps in final graph ─────────────────────────

    const removedIds = new Set(
      workers.filter((w) => w.status === "removed").map((w) => w.id),
    );
    for (const w of workers) {
      if (w.status === "removed") continue;
      for (const dep of w.dependencies) {
        if (removedIds.has(dep)) {
          const isNewError = !errors.some(
            (e) =>
              e.code === "dangling_dependency" &&
              e.message.includes(w.id) &&
              e.message.includes(dep),
          );
          if (isNewError) {
            errors.push({
              field: "dependencyGraph",
              message: `Worker "${w.id}" depends on removed worker "${dep}"`,
              code: "dangling_dependency",
            });
          }
        }
      }
    }

    return {
      workers,
      edges,
      idMap,
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Resolve a worker reference string to a SimulatedWorker.
   * The reference can be an existing worker ID or a draftWorkerId.
   */
  private static resolveWorker(
    ref: string,
    workers: SimulatedWorker[],
    existingIds: Set<string>,
    idMap: Record<string, string>,
  ): SimulatedWorker | undefined {
    if (existingIds.has(ref)) {
      return workers.find((w) => w.id === ref);
    }
    const durableId = idMap[ref];
    if (durableId) {
      return workers.find((w) => w.id === durableId);
    }
    return workers.find((w) => w.id === ref);
  }

  /**
   * Detect a cycle in a directed graph represented as an adjacency list.
   * Uses DFS with white/gray/black coloring.
   *
   * @param adjacency — Map from node ID to list of dependency node IDs.
   * @returns The cycle path as an array of IDs, or null if acyclic.
   */
  private static detectCycle(
    adjacency: Map<string, string[]>,
  ): string[] | null {
    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;

    const color = new Map<string, number>();
    for (const id of adjacency.keys()) {
      color.set(id, WHITE);
    }

    const parent = new Map<string, string | null>();
    let cyclePath: string[] | null = null;

    const dfs = (node: string): void => {
      if (cyclePath) return;
      color.set(node, GRAY);

      const neighbors = adjacency.get(node) ?? [];
      for (const neighbor of neighbors) {
        if (!color.has(neighbor)) continue;
        if (color.get(neighbor) === GRAY) {
          // Found a back edge — reconstruct cycle
          const cycle: string[] = [];
          cycle.push(neighbor);
          let cur = node;
          while (cur && cur !== neighbor) {
            cycle.push(cur);
            cur = parent.get(cur) ?? "";
          }
          cyclePath = cycle;
          return;
        }
        if (color.get(neighbor) === WHITE) {
          parent.set(neighbor, node);
          dfs(neighbor);
        }
      }

      color.set(node, BLACK);
    };

    for (const id of adjacency.keys()) {
      if (color.get(id) === WHITE) dfs(id);
      if (cyclePath) break;
    }

    return cyclePath;
  }
}
