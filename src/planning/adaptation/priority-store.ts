/**
 * P5.4.1 — PriorityStore: persist ProposalPriorityReport files.
 *
 * Mirrors the IntelligenceStore pattern exactly. Reports are saved as JSON
 * files under `.alix/adaptation/priorities/` keyed by generatedAt timestamp.
 *
 * @module
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProposalPriorityReport } from "./priority-types.js";

export class PriorityStore {
  constructor(private readonly dir: string) {}

  /** Save a priority report to disk. Creates directory if needed. */
  async save(report: ProposalPriorityReport): Promise<void> {
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }
    const filename = report.generatedAt.replace(/:/g, "-") + ".json";
    writeFileSync(join(this.dir, filename), JSON.stringify(report, null, 2), "utf-8");
  }

  /** Load a specific report by filename. */
  async load(filename: string): Promise<ProposalPriorityReport | null> {
    const path = join(this.dir, filename);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8")) as ProposalPriorityReport;
  }

  /** List all report filenames, sorted newest-first. */
  async list(): Promise<string[]> {
    if (!existsSync(this.dir)) return [];
    const files = readdirSync(this.dir).filter((f) => f.endsWith(".json"));
    files.sort().reverse();
    return files;
  }

  /** Load the most recent report (by filename sort). */
  async loadLatest(): Promise<ProposalPriorityReport | null> {
    const files = await this.list();
    if (files.length === 0) return null;
    return this.load(files[0]);
  }
}
