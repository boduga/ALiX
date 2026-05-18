import { MemoryStore } from "./store.js";
import type { MemoryEntry } from "./types.js";

export type RecallLevel = "brief" | "standard" | "detailed";

export type RecallOptions = {
  level?: RecallLevel;
  types?: ("user" | "project" | "feedback" | "reference")[];
  limit?: number;
  minConfidence?: number;
};

export type RecallResult = {
  level: RecallLevel;
  entries: MemoryEntry[];
  context: string;
};

/**
 * Progressive recall - retrieves memories at different levels of detail
 */
export function recall(
  query: string,
  store: MemoryStore,
  options: RecallOptions = {}
): RecallResult {
  const {
    level = "standard",
    types,
    limit = 10,
    minConfidence = 0,
  } = options;

  // Find matching entries
  let entries = store.find(query, limit * 2);

  // Filter by types if specified
  if (types && types.length > 0) {
    entries = entries.filter((e) => types.includes(e.type));
  }

  // Filter by minimum confidence
  if (minConfidence > 0) {
    entries = entries.filter((e) => e.confidence >= minConfidence);
  }

  // Sort by confidence descending
  entries.sort((a, b) => b.confidence - a.confidence);

  // Apply limit
  entries = entries.slice(0, limit);

  // Build context based on recall level
  const context = buildContext(entries, level);

  return { level, entries, context };
}

/**
 * Build context string for system prompt based on recall level
 */
export function buildMemoryContext(store: MemoryStore): string {
  const index = store.loadIndex();
  if (!index) {
    return "No memory entries found.";
  }

  // For system prompts, provide a summary of available memories
  const lines = index.split("\n");
  const summary: string[] = [];
  let currentSection = "";

  for (const line of lines) {
    if (line.startsWith("## ")) {
      currentSection = line.slice(3).toLowerCase();
      summary.push(`\n### ${currentSection} memories`);
    } else if (line.startsWith("- [")) {
      summary.push(line);
    }
  }

  return summary.join("\n") || "No memories recorded.";
}

function buildContext(entries: MemoryEntry[], level: RecallLevel): string {
  if (entries.length === 0) {
    return "No matching memories found.";
  }

  const sections: string[] = [];

  switch (level) {
    case "brief":
      // Just names and confidence
      sections.push("Relevant memories:");
      for (const entry of entries) {
        sections.push(`- ${entry.name} (${(entry.confidence * 100).toFixed(0)}% confidence)`);
      }
      break;

    case "standard":
      // Names, descriptions, and confidence
      sections.push("## Relevant memories\n");
      for (const entry of entries) {
        sections.push(`### ${entry.name}`);
        sections.push(`*${entry.description}* (${(entry.confidence * 100).toFixed(0)}% confidence)`);
        sections.push(entry.content.slice(0, 200) + (entry.content.length > 200 ? "..." : ""));
        sections.push("");
      }
      break;

    case "detailed":
      // Full entry content
      sections.push("## Relevant memories\n");
      for (const entry of entries) {
        sections.push(`### ${entry.name}`);
        sections.push(`**Type:** ${entry.type}`);
        sections.push(`**Confidence:** ${(entry.confidence * 100).toFixed(0)}%`);
        sections.push(`**Confirmations:** ${entry.confirmations}`);
        if (entry.source) {
          sections.push(`**Source:** ${entry.source}`);
        }
        sections.push(`**Created:** ${entry.createdAt}`);
        sections.push("");
        sections.push(entry.content);
        sections.push("\n---\n");
      }
      break;
  }

  return sections.join("\n");
}