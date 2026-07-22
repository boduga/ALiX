/**
 * P7.5p.1a — ApprovalRecommendationStore.
 *
 * Append-only JSONL persistence for ApprovalRecommendation artifacts.
 * Mirrors the pattern of OutcomeStore, ProposalStore, and the other 8
 * stores. Read-only relative to the governance lifecycle — never
 * creates proposals, never invokes the approval gate.
 *
 * Storage: .alix/recommendations/recommendations.jsonl
 *
 * @module
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { ApprovalRecommendation } from "./recommendation-types.js";

const STORE_DIR = join(".alix", "recommendations");
const STORE_FILE = join(STORE_DIR, "recommendations.jsonl");

export class ApprovalRecommendationStore {
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
   * Append one recommendation to the store. The recommendation is
   * stored verbatim. Returns nothing (use get(id) to read back).
   */
  async append(rec: ApprovalRecommendation): Promise<void> {
    this.ensureStoreDir();
    const line = JSON.stringify(rec) + "\n";
    appendFileSync(this.filePath(), line, "utf-8");
  }

  /**
   * Look up a recommendation by id. Returns the FIRST match (the
   * store is append-only; duplicate ids are possible but the first
   * append is the canonical record).
   */
  async get(id: string): Promise<ApprovalRecommendation | null> {
    const all = await this.list();
    return all.find((r) => r.id === id) ?? null;
  }

  /**
   * Read all recommendations in the store, skipping corrupt lines.
   */
  async list(): Promise<ApprovalRecommendation[]> {
    const filePath = this.filePath();
    if (!existsSync(filePath)) return [];
    const raw = readFileSync(filePath, "utf-8");
    const out: ApprovalRecommendation[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed) as ApprovalRecommendation);
      } catch {
        // Skip corrupt lines.
      }
    }
    return out;
  }

  /**
   * Read all recommendations whose generatedAt is within the last
   * `windowDays` days. `now` defaults to the wall clock; pass it for
   * determinism against fixed test fixtures.
   */
  async queryByWindow(windowDays: number, now?: string): Promise<ApprovalRecommendation[]> {
    const refMs = now ? Date.parse(now) : Date.now();
    if (!Number.isFinite(refMs)) {
      throw new Error(`queryByWindow: now=${JSON.stringify(now)} is not parseable`);
    }
    const cutoff = refMs - windowDays * 86_400_000;
    const all = await this.list();
    return all.filter((r) => new Date(r.generatedAt).getTime() >= cutoff);
  }
}
