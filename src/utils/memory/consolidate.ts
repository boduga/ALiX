import fs from "node:fs";
import path from "node:path";
import { MemoryStore } from "./store.js";
import type { MemoryEntry } from "./types.js";

export type ConsolidateResult = {
  decisions: string[];
  archived: number;
  updated: number;
};

/**
 * Sleep cycle processing - consolidate memories after session
 */
export function consolidate(store: MemoryStore): ConsolidateResult {
  const decisions = extractDecisionsFromLogs(store);
  const result: ConsolidateResult = {
    decisions,
    archived: 0,
    updated: 0,
  };

  // Apply decay to old entries
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const types = ["user", "project", "feedback", "reference"] as const;

  for (const type of types) {
    const typeDir = path.join(store["basePath"], type);
    if (!fs.existsSync(typeDir)) continue;

    const files = fs.readdirSync(typeDir).filter((f) => f.endsWith(".md"));

    for (const file of files) {
      const filePath = path.join(typeDir, file);
      const content = fs.readFileSync(filePath, "utf-8");
      const entry = parseEntry(content);

      if (!entry) continue;

      // Check if entry is older than decay threshold
      const createdAt = new Date(entry.createdAt);
      if (createdAt < thirtyDaysAgo && entry.confidence < 0.9) {
        // Decay confidence by 10%
        const newConfidence = Math.max(0, entry.confidence - 0.1);
        entry.confidence = newConfidence;
        entry.modifiedAt = new Date().toISOString();

        // Update file if confidence dropped significantly
        if (newConfidence < entry.confidence) {
          const updatedContent = updateEntryFrontmatter(content, entry);
          fs.writeFileSync(filePath, updatedContent);
          result.updated++;
        }

        // Archive entries with very low confidence
        if (newConfidence < 0.2) {
          const archiveDir = path.join(store["basePath"], "archived");
          fs.mkdirSync(archiveDir, { recursive: true });
          const archivePath = path.join(archiveDir, `${type}-${file}`);
          fs.renameSync(filePath, archivePath);
          result.archived++;
        }
      }
    }
  }

  // Rebuild index after consolidation
  store.buildIndex();

  return result;
}

/**
 * Extract decisions from log content
 */
export function extractDecisions(content: string): string[] {
  const decisions: string[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    // Look for decision patterns
    const decisionPatterns = [
      /^decide[sd]?:\s*(.+)/i,
      /^decision:\s*(.+)/i,
      /^chose:\s*(.+)/i,
      /^selected:\s*(.+)/i,
      /^\*\*Decision\*\*:\s*(.+)/i,
      /^→\s*(.+)/i,
    ];

    for (const pattern of decisionPatterns) {
      const match = line.match(pattern);
      if (match) {
        decisions.push(match[1].trim());
      }
    }

    // Look for "we decided to" or "we chose" patterns
    const weDecidedMatch = line.match(/\b(?:we decided|we chose|i decided|i chose)\s+(?:to\s+)?(.+)/i);
    if (weDecidedMatch) {
      decisions.push(weDecidedMatch[1].trim());
    }
  }

  return decisions;
}

function extractDecisionsFromLogs(store: MemoryStore): string[] {
  const logsDir = path.join(store["basePath"], "logs");
  if (!fs.existsSync(logsDir)) return [];

  const allDecisions: string[] = [];
  const files = fs.readdirSync(logsDir).filter((f) => f.endsWith(".md"));

  // Get recent logs (last 7 days)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  for (const file of files) {
    const filePath = path.join(logsDir, file);
    const stats = fs.statSync(filePath);

    if (stats.mtime > sevenDaysAgo) {
      const content = fs.readFileSync(filePath, "utf-8");
      const decisions = extractDecisions(content);
      allDecisions.push(...decisions);
    }
  }

  return allDecisions;
}

function parseEntry(content: string): { createdAt: string; modifiedAt: string; confidence: number; confirmations: number } | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;

  const frontmatter = match[1];
  const data: Record<string, string> = {};

  for (const line of frontmatter.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    data[key] = value;
  }

  return {
    createdAt: data.createdAt || "",
    modifiedAt: data.modifiedAt || "",
    confidence: parseFloat(data.confidence) || 0.5,
    confirmations: parseInt(data.confirmations) || 0,
  };
}

function updateEntryFrontmatter(content: string, entry: { confidence: number; modifiedAt: string; confirmations: number }): string {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return content;

  const frontmatter = match[1];
  const body = match[2];

  // Update confidence and modifiedAt in frontmatter
  const updatedFrontmatter = frontmatter
    .replace(/^confidence:.*$/m, `confidence: ${entry.confidence}`)
    .replace(/^modifiedAt:.*$/m, `modifiedAt: ${entry.modifiedAt}`)
    .replace(/^confirmations:.*$/m, `confirmations: ${entry.confirmations}`);

  return `---\n${updatedFrontmatter}\n---\n${body}`;
}