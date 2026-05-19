import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type ReliabilityEntry = {
  model: string;
  provider: string;
  editFormats: Record<string, number>; // success rate (0-1)
  toolCalls: Record<string, number>;
  avgLatencyMs: number;
};

export type ReliabilityMatrixData = {
  version: number;
  entries: ReliabilityEntry[];
};

// Default fallback entry used when model/provider not in matrix
const DEFAULT_ENTRY: ReliabilityEntry = {
  model: "*",
  provider: "*",
  editFormats: {
    "search_replace": 0.85,
    "structured_patch": 0.80,
    "inline": 0.75,
    "whole_file": 0.90
  },
  toolCalls: {
    "file.read": 0.98,
    "file.write": 0.95,
    "patch.apply": 0.85,
    "shell.run": 0.90
  },
  avgLatencyMs: 500
};

let cachedMatrix: ReliabilityMatrix | undefined;

export class ReliabilityMatrix {
  private entries: Map<string, ReliabilityEntry>;
  private data: ReliabilityMatrixData;

  private constructor(data: ReliabilityMatrixData) {
    this.data = data;
    this.entries = new Map();
    for (const entry of data.entries) {
      const key = `${entry.provider}:${entry.model}`;
      this.entries.set(key, entry);
    }
  }

  /**
   * Get reliability data for a specific model and provider.
   * Falls back to wildcard "*" entry if exact match not found,
   * then to hardcoded defaults if no wildcard match.
   */
  getEntry(model: string, provider: string): ReliabilityEntry {
    // Try exact match first
    const exactKey = `${provider}:${model}`;
    if (this.entries.has(exactKey)) {
      return this.entries.get(exactKey)!;
    }

    // Try provider wildcard
    const providerWildcardKey = `${provider}:*`;
    if (this.entries.has(providerWildcardKey)) {
      return this.entries.get(providerWildcardKey)!;
    }

    // Try model wildcard
    const modelWildcardKey = `*:${model}`;
    if (this.entries.has(modelWildcardKey)) {
      return this.entries.get(modelWildcardKey)!;
    }

    // Try full wildcard
    if (this.entries.has("*:*")) {
      return this.entries.get("*:*")!;
    }

    // Fall back to hardcoded defaults
    return DEFAULT_ENTRY;
  }

  /**
   * Get success rate for a specific edit format.
   */
  getEditFormatSuccessRate(model: string, provider: string, format: string): number {
    const entry = this.getEntry(model, provider);
    return entry.editFormats[format] ?? 0.85;
  }

  /**
   * Get success rate for a specific tool call.
   */
  getToolCallSuccessRate(model: string, provider: string, toolName: string): number {
    const entry = this.getEntry(model, provider);
    return entry.toolCalls[toolName] ?? 0.90;
  }

  /**
   * Get average latency for a model/provider.
   */
  getAvgLatencyMs(model: string, provider: string): number {
    const entry = this.getEntry(model, provider);
    return entry.avgLatencyMs;
  }

  /**
   * Rank edit formats by reliability for a given model/provider.
   * Returns formats sorted from highest to lowest success rate.
   */
  rankEditFormats(model: string, provider: string): string[] {
    const entry = this.getEntry(model, provider);
    return Object.entries(entry.editFormats)
      .sort(([, a], [, b]) => b - a)
      .map(([format]) => format);
  }

  /**
   * Load the reliability matrix from JSON file.
   * Uses cached instance if available.
   */
  static load(): ReliabilityMatrix {
    if (cachedMatrix) {
      return cachedMatrix;
    }

    const jsonPath = join(__dirname, "reliability-matrix.json");
    if (!existsSync(jsonPath)) {
      // Return a matrix with just defaults if JSON doesn't exist
      cachedMatrix = new ReliabilityMatrix({ version: 1, entries: [] });
      return cachedMatrix;
    }

    // Synchronous read for simplicity - file is small
    const content = readFileSync(jsonPath, "utf8");
    const data = JSON.parse(content) as ReliabilityMatrixData;
    cachedMatrix = new ReliabilityMatrix(data);
    return cachedMatrix;
  }

  /**
   * Reset the cached matrix (useful for testing).
   */
  static resetCache(): void {
    cachedMatrix = undefined;
  }

  /**
   * Get all entries in the matrix.
   */
  getEntries(): ReliabilityEntry[] {
    return Array.from(this.entries.values());
  }
}
