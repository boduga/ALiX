import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pattern, PatternFile } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PATTERNS_DIR = join(__dirname, "..", "patterns");

const DEFAULT_CONFIDENCE_THRESHOLD = 0.75;

export class PatternRegistry {
  private patterns = new Map<string, Pattern[]>();
  private threshold: number;

  constructor(threshold = DEFAULT_CONFIDENCE_THRESHOLD) {
    this.threshold = threshold;
  }

  loadModel(modelId: string): Pattern[] {
    const safeId = modelId.replace(/[^a-zA-Z0-9_.-]/g, "_");
    const filePath = join(PATTERNS_DIR, `${safeId}.json`);

    if (!existsSync(filePath)) {
      this.patterns.set(modelId, []);
      return [];
    }

    const content = readFileSync(filePath, "utf-8");
    const data = JSON.parse(content) as PatternFile;

    const active = data.patterns.filter(
      (p) => p.deprecated === null && p.confidence >= this.threshold
    );
    this.patterns.set(modelId, active);
    return active;
  }

  getPatterns(modelId: string): Pattern[] {
    if (!this.patterns.has(modelId)) {
      return this.loadModel(modelId);
    }
    return this.patterns.get(modelId) ?? [];
  }

  getPatternsForTool(modelId: string, toolName: string): Pattern[] {
    return this.getPatterns(modelId).filter(
      (p) => p.tools.includes("*") || p.tools.includes(toolName)
    );
  }

  registerPatterns(modelId: string, patterns: Pattern[]): void {
    this.patterns.set(modelId, patterns);
  }

  static listAvailableModels(): string[] {
    if (!existsSync(PATTERNS_DIR)) return [];
    return readdirSync(PATTERNS_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));
  }

  reloadAll(): void {
    this.patterns.clear();
  }

  getThreshold(): number {
    return this.threshold;
  }
}
