/**
 * P7.5p.3a — GovernanceReviewStore.
 *
 * Append-only JSONL persistence for GovernanceReview artifacts.
 * Mirrors the pattern of RiskScoreStore (P7.5p.2a) and
 * ApprovalRecommendationStore (P7.5p.1a). Read-only relative to the
 * governance lifecycle — never creates proposals, never invokes the
 * approval gate, never re-aggregates.
 *
 * Storage: .alix/governance-reviews/governance-reviews.jsonl
 *
 * @module
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { GovernanceReview } from "./governance-review-types.js";

const STORE_DIR = join(".alix", "governance-reviews");
const STORE_FILE = join(STORE_DIR, "governance-reviews.jsonl");

export class GovernanceReviewStore {
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
   * Append one governance review to the store. The review is stored verbatim.
   */
  async append(review: GovernanceReview): Promise<void> {
    this.ensureStoreDir();
    const line = JSON.stringify(review) + "\n";
    appendFileSync(this.filePath(), line, "utf-8");
  }

  /**
   * Look up a governance review by id. Returns the FIRST match.
   */
  async get(id: string): Promise<GovernanceReview | null> {
    const all = await this.list();
    return all.find((r) => r.id === id) ?? null;
  }

  /**
   * Read all governance reviews in the store, skipping corrupt lines.
   */
  async list(): Promise<GovernanceReview[]> {
    const filePath = this.filePath();
    if (!existsSync(filePath)) return [];
    const raw = readFileSync(filePath, "utf-8");
    const out: GovernanceReview[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed) as GovernanceReview);
      } catch {
        // Skip corrupt lines.
      }
    }
    return out;
  }

  /**
   * Read all governance reviews whose generatedAt is within the last
   * `windowDays` days.
   */
  async queryByWindow(windowDays: number): Promise<GovernanceReview[]> {
    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    const all = await this.list();
    return all.filter((r) => new Date(r.generatedAt).getTime() >= cutoff);
  }

  /**
   * Read all governance reviews for a given proposalId, in append order
   * (oldest first; the LAST element is the most recent). Used by the
   * outcome CLI's auto-lookup to link an outcome to the most recent review.
   */
  async queryByProposal(proposalId: string): Promise<GovernanceReview[]> {
    const all = await this.list();
    return all.filter((r) => r.proposalId === proposalId);
  }
}
