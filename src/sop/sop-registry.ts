/**
 * sop-registry.ts — Built-in SOP pack definitions.
 *
 * Each SOP knows how to build a TaskGraph for its workflow.
 * SOPs are deterministic — they define node structure, not model planning.
 */

import type { TaskGraph } from "../kernel/task-graph.js";

export interface SopDefinition {
  id: string;
  name: string;
  description: string;
  buildGraph: (input: Record<string, unknown>) => { graph: TaskGraph; reportDir: string };
}

const registry = new Map<string, SopDefinition>();

export function registerSop(def: SopDefinition): void {
  registry.set(def.id, def);
}

export function getSop(id: string): SopDefinition | undefined {
  return registry.get(id);
}

export function listSops(): SopDefinition[] {
  return Array.from(registry.values());
}

// Auto-register built-in SOPs
import { getResearchDeepReportDef } from "./research-deep-report.js";
registerSop(getResearchDeepReportDef());
