/**
 * P5.2b.4 — EffectivenessStore.
 *
 * Append-only JSON persistence for ProposalEffectivenessReports, keyed by
 * `proposalId`. Files live under `<dir>/<proposalId>.json`. Mirrors the shape
 * of `ProposalStore` (save/load/list) but is intentionally separate so
 * effectiveness reports and proposals can evolve independently.
 *
 * @module
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ProposalEffectivenessReport } from "./effectiveness-types.js";

export class EffectivenessStore {
  constructor(private readonly dir: string) {}

  /** Persist a report. Creates the directory if it does not exist. */
  async save(report: ProposalEffectivenessReport): Promise<void> {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, `${report.proposalId}.json`), JSON.stringify(report, null, 2), "utf-8");
  }

  /** Load a report by proposalId, or null if not found. */
  async load(proposalId: string): Promise<ProposalEffectivenessReport | null> {
    const path = join(this.dir, `${proposalId}.json`);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8")) as ProposalEffectivenessReport;
  }

  /** List every saved report. Returns [] if the directory does not exist. */
  async list(): Promise<ProposalEffectivenessReport[]> {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(this.dir, f), "utf-8")) as ProposalEffectivenessReport);
  }
}