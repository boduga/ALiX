import yaml from "yaml";
import fs from "node:fs/promises";
import path from "node:path";
import { MemoryStore } from "./store.js";
import type { MemoryEntry } from "./types.js";

export type RecallLevel = "brief" | "standard" | "detailed";

export type RecallOptions = {
  level?: RecallLevel;
  types?: ("user" | "project" | "feedback" | "reference")[];
  limit?: number;
  minConfidence?: number;
};

/**
 * Build stats summary of all memories — lightweight, no full content loading.
 * Groups by type, shows confirmation counts, sorted by confidence.
 */
export async function buildMemoryStats(store: MemoryStore): Promise<string> {
  const types: MemoryEntry["type"][] = ["user", "project", "feedback", "reference"];
  const allEntries: MemoryEntry[] = [];

  for (const type of types) {
    const typeDir = path.join(store.getBasePath(), type);
    try {
      const files = await fs.readdir(typeDir);
      for (const file of files.filter(f => f.endsWith(".md"))) {
        const content = await fs.readFile(path.join(typeDir, file), "utf-8");
        const entry = parseEntry(content);
        if (entry) allEntries.push(entry);
      }
    } catch {
      // Directory doesn't exist or empty
    }
  }

  if (allEntries.length === 0) {
    return "";
  }

  // Group by type
  const byType: Record<string, MemoryEntry[]> = {};
  for (const entry of allEntries) {
    if (!byType[entry.type]) byType[entry.type] = [];
    byType[entry.type].push(entry);
  }

  // Sort each type by confidence descending
  for (const type of Object.keys(byType)) {
    byType[type].sort((a, b) => b.confidence - a.confidence);
  }

  const total = allEntries.length;
  const lines: string[] = [`Loaded ${total} memories:`];

  for (const type of types) {
    const entries = byType[type];
    if (!entries || entries.length === 0) continue;
    for (const entry of entries) {
      const confirmed = entry.confirmations > 0 ? ` (confirmed ${entry.confirmations}x)` : "";
      lines.push(`- [${type}] ${entry.name} - ${entry.description}${confirmed}`);
    }
  }

  return lines.join("\n");
}

export type RecallResult = {
  level: RecallLevel;
  entries: MemoryEntry[];
  context: string;
};

function parseEntry(content: string): MemoryEntry | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;

  try {
    const frontmatter = match[1];

    const data = yaml.parse(frontmatter) as Record<string, string>;

    return {
      name: data.name || "",
      description: data.description || "",
      type: (data.type as MemoryEntry["type"]) || "project",
      content: "",
      createdAt: data.createdAt || "",
      modifiedAt: data.modifiedAt || "",
      confidence: parseFloat(data.confidence) || 0.5,
      confirmations: parseInt(data.confirmations) || 0,
      source: data.source,
    };
  } catch {
    return null;
  }
}

/**
 * Progressive recall - retrieves memories at different levels of detail
 */
export async function recall(
  query: string,
  store: MemoryStore,
  options: RecallOptions = {}
): Promise<RecallResult> {
  const {
    level = "standard",
    types,
    limit = 10,
    minConfidence = 0,
  } = options;

  // Find matching entries
  let entries = await store.find(query, limit * 2);

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
export async function buildMemoryContext(store: MemoryStore): Promise<string> {
  const index = await store.loadIndex();
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