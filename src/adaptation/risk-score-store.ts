/**
 * P7.5p.2a — RiskScoreStore.
 *
 * Append-only JSONL persistence for RiskScore artifacts.
 * Mirrors the pattern of ApprovalRecommendationStore (P7.5p.1a) and
 * OutcomeStore (P7a). Read-only relative to the governance lifecycle —
 * never creates proposals, never invokes the approval gate.
 *
 * Storage: .alix/risk-scores/risk-scores.jsonl
 *
 * @module
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { RiskScore } from "./risk-score-types.js";

const STORE_DIR = join(".alix", "risk-scores");
const STORE_FILE = join(STORE_DIR, "risk-scores.jsonl");

export class RiskScoreStore {
  constructor(
    private readonly storeDir: string = join(process.cwd(), STORE_DIR),
  ) {}

  private ensureStoreDir(): void {
    if (!existsSync(this.storeDir)) {
      mkdirSync(this.storeDir, { recursive: true });
    }
  }

  private filePath(): string {
    return join(this.storeDir, STORE_FILE.split("/").pop()!);
  }

  /**
   * Append one risk score to the store. The score is stored verbatim.
   * Returns nothing (use get(id) to read back).
   */
  async append(score: RiskScore): Promise<void> {
    this.ensureStoreDir();
    const line = JSON.stringify(score) + "\n";
    appendFileSync(this.filePath(), line, "utf-8");
  }

  /**
   * Look up a risk score by id. Returns the FIRST match (the store is
   * append-only; duplicate ids are possible but the first append is the
   * canonical record).
   */
  async get(id: string): Promise<RiskScore | null> {
    const all = await this.list();
    return all.find((r) => r.id === id) ?? null;
  }

  /**
   * Read all risk scores in the store, skipping corrupt lines.
   */
  async list(): Promise<RiskScore[]> {
    const filePath = this.filePath();
    if (!existsSync(filePath)) return [];
    const raw = readFileSync(filePath, "utf-8");
    const out: RiskScore[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed) as RiskScore);
      } catch {
        // Skip corrupt lines.
      }
    }
    return out;
  }

  /**
   * Read all risk scores whose generatedAt is within the last `windowDays`
   * days. `now` defaults to the wall clock; pass it explicitly for
   * determinism against fixed test fixtures (see outcome-store's
   * `queryByWindow` for the same note about silent temporal drift).
   */
  async queryByWindow(windowDays: number, now?: string): Promise<RiskScore[]> {
    const refMs = now ? Date.parse(now) : Date.now();
    if (!Number.isFinite(refMs)) {
      throw new Error(`queryByWindow: now=${JSON.stringify(now)} is not parseable`);
    }
    const cutoff = refMs - windowDays * 86_400_000;
    const all = await this.list();
    return all.filter((r) => new Date(r.generatedAt).getTime() >= cutoff);
  }
}