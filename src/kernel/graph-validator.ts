/**
 * graph-validator.ts — Runtime-safe structural and DAG validation.
 *
 * Validation order:
 *   1. Graph is an object
 *   2. Graph and node IDs are filesystem-safe
 *   3. Nodes is an array of objects
 *   4. Graph is non-empty
 *   5. Node IDs are unique
 *   6. Dependencies are arrays
 *   7. No self-dependencies
 *   8. All dependency references exist
 *   9. Graph is acyclic
 */

import type { TaskGraph } from "./task-graph.js";

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export type DagValidationResult = {
  valid: boolean;
  safeToPersist: boolean;
  errors: string[];
  topologicalOrder: string[];
};

function validateGraphIdentity(graph: unknown): string[] {
  const errors: string[] = [];

  if (!graph || typeof graph !== "object") {
    return ["Graph must be an object"];
  }

  const candidate = graph as { id?: unknown; nodes?: unknown };

  if (typeof candidate.id !== "string" || !SAFE_ID.test(candidate.id)) {
    errors.push(`Unsafe graph ID: "${String(candidate.id ?? "")}"`);
  }

  if (!Array.isArray(candidate.nodes)) {
    errors.push("Graph nodes must be an array");
    return errors;
  }

  for (const rawNode of candidate.nodes) {
    if (!rawNode || typeof rawNode !== "object") {
      errors.push("Graph node must be an object");
      continue;
    }
    const node = rawNode as { id?: unknown };
    if (typeof node.id !== "string" || !SAFE_ID.test(node.id)) {
      errors.push(`Unsafe node ID: "${String(node.id ?? "")}"`);
    }
  }

  return errors;
}

export function validateGraphDag(graph: unknown): DagValidationResult {
  const identityErrors = validateGraphIdentity(graph);

  if (identityErrors.length > 0) {
    return { valid: false, safeToPersist: false, errors: identityErrors, topologicalOrder: [] };
  }

  const typedGraph = graph as TaskGraph;
  const nodes = typedGraph.nodes;
  const errors: string[] = [];

  if (nodes.length === 0) {
    return { valid: false, safeToPersist: true, errors: ["Graph must have at least 1 node"], topologicalOrder: [] };
  }

  const ids = new Set<string>();
  const duplicateIds: string[] = [];
  for (const node of nodes) {
    if (ids.has(node.id)) duplicateIds.push(node.id);
    ids.add(node.id);
  }
  if (duplicateIds.length > 0) {
    return { valid: false, safeToPersist: true, errors: [`Duplicate node IDs: ${duplicateIds.join(", ")}`], topologicalOrder: [] };
  }

  for (const node of nodes) {
    if (!Array.isArray(node.dependencies)) {
      errors.push(`Node "${node.id}" dependencies must be an array`);
      continue;
    }
    if (node.dependencies.includes(node.id)) {
      errors.push(`Node "${node.id}" depends on itself`);
    }
  }
  if (errors.length > 0) {
    return { valid: false, safeToPersist: true, errors, topologicalOrder: [] };
  }

  for (const node of nodes) {
    for (const dependencyId of node.dependencies) {
      if (!ids.has(dependencyId)) {
        errors.push(`Node "${node.id}" references unknown dependency "${dependencyId}"`);
      }
    }
  }
  if (errors.length > 0) {
    return { valid: false, safeToPersist: true, errors, topologicalOrder: [] };
  }

  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) { inDegree.set(node.id, 0); adjacency.set(node.id, []); }
  for (const node of nodes) {
    for (const dependencyId of node.dependencies) {
      adjacency.get(dependencyId)!.push(node.id);
      inDegree.set(node.id, (inDegree.get(node.id) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [nodeId, degree] of inDegree) { if (degree === 0) queue.push(nodeId); }

  const topologicalOrder: string[] = [];
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    topologicalOrder.push(nodeId);
    for (const neighbor of adjacency.get(nodeId) ?? []) {
      const nextDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, nextDegree);
      if (nextDegree === 0) queue.push(neighbor);
    }
  }

  if (topologicalOrder.length !== nodes.length) {
    const cycleNodes = nodes.filter(node => !topologicalOrder.includes(node.id)).map(node => node.id);
    return { valid: false, safeToPersist: true, errors: [`Cycle detected involving nodes: ${cycleNodes.join(", ")}`], topologicalOrder: [] };
  }

  return { valid: true, safeToPersist: true, errors: [], topologicalOrder };
}
