/**
 * P5.5 — CapabilityEvolutionStore: persist CapabilityEvolutionReport files.
 *
 * Mirrors the IntelligenceStore and PriorityStore patterns exactly.
 *
 * @module
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CapabilityEvolutionReport } from "./capability-evolution-types.js";

export class CapabilityEvolutionStore {
  constructor(private readonly dir: string) {}

  async save(report: CapabilityEvolutionReport): Promise<void> {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    const filename = report.generatedAt.replace(/:/g, "-") + ".json";
    writeFileSync(join(this.dir, filename), JSON.stringify(report, null, 2), "utf-8");
  }

  async load(filename: string): Promise<CapabilityEvolutionReport | null> {
    const path = join(this.dir, filename);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8")) as CapabilityEvolutionReport;
  }

  async list(): Promise<string[]> {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir).filter((f) => f.endsWith(".json")).sort().reverse();
  }

  async loadLatest(): Promise<CapabilityEvolutionReport | null> {
    const files = await this.list();
    if (files.length === 0) return null;
    return this.load(files[0]);
  }
}
