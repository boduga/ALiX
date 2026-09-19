/**
 * worker-role.ts — Capability → subagent role classification.
 *
 * Single authority shared by the planner (ownership scopes) and the
 * subagent worker executor (task mode + ownedPaths). Keeping one
 * classifier prevents the split where the planner over-claims write
 * ownership (`**` via unknown-write) while the executor runs the same
 * worker read-only.
 *
 * Pure and dependency-light — no SubagentManager import.
 */

import type { SubagentRole } from "../config/schema.js";

export const WRITE_CAPABILITIES: ReadonlySet<string> = new Set([
  "filesystem.write",
  "file.create",
  "file.delete",
  "patch.apply",
  "shell.exec",
  "shell.run",
]);

export const RESEARCH_CAPABILITIES: ReadonlySet<string> = new Set([
  "web.search",
  "web.fetch",
]);

export type CapabilityBearing = { requiredCapabilities?: readonly string[] };

export function roleForWorker(worker: CapabilityBearing): SubagentRole {
  const caps = worker.requiredCapabilities ?? [];
  if (caps.some(c => WRITE_CAPABILITIES.has(c))) return "worker";
  if (caps.some(c => RESEARCH_CAPABILITIES.has(c))) return "researcher";
  return "explorer";
}

/** True when the worker is classified as a writer and may own write paths. */
export function isWriteWorker(worker: CapabilityBearing): boolean {
  return roleForWorker(worker) === "worker";
}
