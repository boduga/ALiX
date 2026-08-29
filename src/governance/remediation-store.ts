/**
 * P17/P18 — RemediationStore: append-only JSONL store for GovernanceRemediationProposal records.
 *
 * One JSONL file `.alix/governance/remediation-proposals.jsonl`. save() appends a
 * new record. updateStatus() appends a new version — never rewrites in place.
 * get()/list() resolve the latest version per proposalId (last-wins within
 * ascending line order), matching the InvestigationStore pattern.
 *
 * Mirrors P17.0/P14 store conventions: default dir `.alix/governance/`,
 * async I/O for `save`/`updateStatus`, corrupt lines skipped.
 *
 * @module
 */

import { readFile, appendFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  GovernanceRemediationProposal,
  GovernanceRemediationProposalStatus,
} from "./remediation-queue.js";

const REMEDIATIONS_FILE = "remediation-proposals.jsonl";

export class RemediationStore {
  private readonly dir: string;

  constructor(baseDir: string = process.cwd()) {
    this.dir = join(baseDir, ".alix", "governance");
  }

  private get filePath(): string {
    return join(this.dir, REMEDIATIONS_FILE);
  }

  private async ensureDir(): Promise<void> {
    try {
      await stat(this.dir);
    } catch {
      await mkdir(this.dir, { recursive: true });
    }
  }

  private async readAll(): Promise<GovernanceRemediationProposal[]> {
    let content: string;
    try {
      content = await readFile(this.filePath, "utf8");
    } catch {
      return [];
    }
    const lines = content.trim().split("\n").filter(Boolean);
    const results: GovernanceRemediationProposal[] = [];
    for (const line of lines) {
      try {
        results.push(JSON.parse(line) as GovernanceRemediationProposal);
      } catch {
        // skip corrupt lines
      }
    }
    return results;
  }

  private resolveLatest(
    records: GovernanceRemediationProposal[],
  ): Map<string, GovernanceRemediationProposal> {
    const map = new Map<string, GovernanceRemediationProposal>();
    for (const r of records) {
      map.set(r.proposalId, r);
    }
    return map;
  }

  async append(proposal: GovernanceRemediationProposal): Promise<void> {
    await this.ensureDir();
    await appendFile(this.filePath, JSON.stringify(proposal) + "\n", "utf8");
  }

  async get(proposalId: string): Promise<GovernanceRemediationProposal | null> {
    const all = await this.readAll();
    return this.resolveLatest(all).get(proposalId) ?? null;
  }

  async list(): Promise<GovernanceRemediationProposal[]> {
    const all = await this.readAll();
    const latest = Array.from(this.resolveLatest(all).values());
    latest.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return latest;
  }

  async updateStatus(
    proposalId: string,
    status: GovernanceRemediationProposalStatus,
    now: string = new Date().toISOString(),
  ): Promise<GovernanceRemediationProposal | null> {
    const existing = await this.get(proposalId);
    if (!existing) return null;
    const updated: GovernanceRemediationProposal = {
      ...existing,
      status,
      createdAt: existing.createdAt,
    };
    await this.append(updated);
    return updated;
  }
}
