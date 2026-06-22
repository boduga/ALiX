/**
 * P8.5a.0.2 — EvidenceChainStore.
 *
 * Append-only JSONL persistence for LearningEvidenceChain artifacts.
 *
 * Core invariants:
 * - Append-only: no delete / update / clear / truncate / setChain /
 *   replaceChain / modifySource / writeBack methods.
 * - Source artifacts are facts: the store never accepts an existing
 *   artifact as a mutable parameter; it only appends new chain
 *   records.
 * - Chains do not carry mutation authority: the store cannot create
 *   AdaptationProposals, trigger ApprovalGate, or invoke any applier.
 *
 * Storage: .alix/learning/evidence-chains.jsonl
 *
 * @module
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { LearningEvidenceChain } from "./evidence-chain-types.js";

const STORE_DIR = join(".alix", "learning");
const STORE_FILE = join(STORE_DIR, "evidence-chains.jsonl");

function now(): string {
  return new Date().toISOString();
}

function shortId(prefix: string): string {
  // Compact, sortable id; not security-sensitive.
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${t}-${r}`;
}

export class EvidenceChainStore {
  constructor(
    private readonly storeDir: string = join(process.cwd(), STORE_DIR),
  ) {}

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private ensureStoreDir(): void {
    if (!existsSync(this.storeDir)) {
      mkdirSync(this.storeDir, { recursive: true });
    }
  }

  private filePath(): string {
    return join(this.storeDir, STORE_FILE.split("/").pop()!);
  }

  // -------------------------------------------------------------------------
  // Append — the ONLY mutation primitive
  // -------------------------------------------------------------------------

  /**
   * Append one chain to the store. Returns a deep copy of the persisted
   * record with `id` and `generatedAt` filled in if they were missing.
   *
   * IMPORTANT: This is the only method that writes to disk. No delete,
   * update, clear, or truncate primitive exists.
   */
  async appendChain(chain: LearningEvidenceChain): Promise<LearningEvidenceChain> {
    this.ensureStoreDir();
    const id = chain.id && chain.id.length > 0 ? chain.id : shortId("chain");
    const generatedAt = chain.generatedAt && chain.generatedAt.length > 0 ? chain.generatedAt : now();
    const record: LearningEvidenceChain = {
      ...chain,
      id,
      generatedAt,
    };
    const line = JSON.stringify(record) + "\n";
    appendFileSync(this.filePath(), line, "utf-8");
    return record;
  }

  // -------------------------------------------------------------------------
  // Query — read-only
  // -------------------------------------------------------------------------

  /**
   * Read all chains whose `rootArtifactId` matches the given value.
   */
  async getChainForRoot(rootArtifactId: string): Promise<LearningEvidenceChain[]> {
    const all = await this.listChains();
    return all.filter((c) => c.rootArtifactId === rootArtifactId);
  }

  /**
   * Read all chains in the store, skipping corrupt lines.
   */
  async listChains(): Promise<LearningEvidenceChain[]> {
    const filePath = this.filePath();
    if (!existsSync(filePath)) return [];
    const raw = readFileSync(filePath, "utf-8");
    const out: LearningEvidenceChain[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed) as LearningEvidenceChain);
      } catch {
        // Skip corrupt lines (matches LearningStore P8.0b pattern).
      }
    }
    return out;
  }
}