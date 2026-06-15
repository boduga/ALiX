/**
 * mutation-classifier.ts — ToolRegistry-based mutation classification.
 */

import type { ToolRegistry } from "../tools/tool-registry.js";

export type MutationClass = "known-write" | "unknown-write" | "no-write";

export function classifyCapabilities(
  capabilities: string[],
  registry: ToolRegistry,
): MutationClass {
  if (capabilities.length === 0) {
    return "unknown-write";
  }

  const tools = registry.getAll();

  let foundKnownWrite = false;
  let foundUnknown = false;

  for (const capability of capabilities) {
    const record = tools.find(tool =>
      tool.name === capability || tool.capabilityId === capability,
    );

    if (!record) {
      foundUnknown = true;
      continue;
    }

    if (record.mutates) {
      foundKnownWrite = true;
    }
  }

  if (foundKnownWrite) return "known-write";
  if (foundUnknown) return "unknown-write";
  return "no-write";
}
