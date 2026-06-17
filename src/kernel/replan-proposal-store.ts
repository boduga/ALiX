/**
 * replan-proposal-store.ts — Durable persistence for proposal lifecycle.
 *
 * Each proposal is persisted as:
 *   .alix/coordination/replans/<runId>/<proposalId>.json
 *
 * Atomic writes via temp-file + rename (same pattern as CoordinationStore).
 * Fingerprints are computed at creation time for integrity verification.
 */

import { readFile, writeFile, mkdir, readdir, unlink, rename as renameFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type {
  ProposalRecord,
  ProposalStatus,
  PlanRevisionDraft,
  ImpactAnalysis,
} from "./replan-types.js";
import { computeFingerprint } from "./replan-types.js";

export class ReplanProposalStore {
  private readonly cwd: string;
  private readonly baseDir: string;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.baseDir = join(cwd, ".alix", "coordination", "replans");
  }

  private runDir(runId: string): string {
    return join(this.baseDir, runId);
  }

  private proposalPath(runId: string, proposalId: string): string {
    return join(this.runDir(runId), `${proposalId}.json`);
  }

  private async ensureRunDir(runId: string): Promise<void> {
    const dir = this.runDir(runId);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }

  // ── CRUD Operations ────────────────────────────────────────────────

  /**
   * Create a new proposal record. Computes draftFingerprint automatically
   * if not already set. Persists atomically via tmp + rename.
   */
  async create(proposal: ProposalRecord): Promise<ProposalRecord> {
    await this.ensureRunDir(proposal.runId);

    // Ensure fingerprint is computed
    const record: ProposalRecord = {
      ...proposal,
      draftFingerprint: proposal.draftFingerprint || computeFingerprint(proposal.draft),
      updatedAt: new Date().toISOString(),
    };

    const path = this.proposalPath(proposal.runId, proposal.id);
    const tmpPath = `${path}.tmp.${randomUUID()}`;
    await writeFile(tmpPath, JSON.stringify(record, null, 2), "utf-8");
    await renameFile(tmpPath, path);
    return record;
  }

  /**
   * Load a proposal by run ID and proposal ID.
   * Returns null if the proposal does not exist or is corrupt.
   */
  async load(runId: string, proposalId: string): Promise<ProposalRecord | null> {
    const path = this.proposalPath(runId, proposalId);
    if (!existsSync(path)) return null;
    try {
      const raw = await readFile(path, "utf-8");
      return JSON.parse(raw) as ProposalRecord;
    } catch {
      return null;
    }
  }

  /**
   * List all proposals for a given run, newest first.
   */
  async listByRunId(runId: string): Promise<ProposalRecord[]> {
    const dir = this.runDir(runId);
    if (!existsSync(dir)) return [];
    const files = await readdir(dir);
    const proposals: ProposalRecord[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(dir, file), "utf-8");
        const proposal = JSON.parse(raw) as ProposalRecord;
        proposals.push(proposal);
      } catch {
        // skip corrupt files
      }
    }
    return proposals.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  /**
   * List proposals across all runs, newest first.
   */
  async listAll(): Promise<ProposalRecord[]> {
    if (!existsSync(this.baseDir)) return [];
    const runDirs = await readdir(this.baseDir);
    const all: ProposalRecord[] = [];
    for (const runId of runDirs) {
      const dir = this.runDir(runId);
      try {
        const files = await readdir(dir);
        for (const file of files) {
          if (!file.endsWith(".json")) continue;
          try {
            const raw = await readFile(join(dir, file), "utf-8");
            const proposal = JSON.parse(raw) as ProposalRecord;
            all.push(proposal);
          } catch {
            // skip corrupt files
          }
        }
      } catch {
        // skip unreadable directories
      }
    }
    return all.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  /**
   * Update the status of a proposal. Loads, patches, and persists atomically.
   * Returns the updated proposal, or null if not found.
   */
  async updateStatus(
    runId: string,
    proposalId: string,
    status: ProposalStatus,
    extra?: { error?: string; approvalId?: string },
  ): Promise<ProposalRecord | null> {
    const proposal = await this.load(runId, proposalId);
    if (!proposal) return null;

    proposal.status = status;
    proposal.updatedAt = new Date().toISOString();
    if (extra?.error !== undefined) proposal.error = extra.error;
    if (extra?.approvalId !== undefined) proposal.approvalId = extra.approvalId;

    const path = this.proposalPath(runId, proposalId);
    const tmpPath = `${path}.tmp.${randomUUID()}`;
    await writeFile(tmpPath, JSON.stringify(proposal, null, 2), "utf-8");
    await renameFile(tmpPath, path);
    return proposal;
  }

  /**
   * Atomically transition a proposal from one status to another.
   * Returns null if the current status does not match expected.
   */
  async transitionStatus(
    runId: string,
    proposalId: string,
    expectedStatus: ProposalStatus,
    newStatus: ProposalStatus,
    extra?: { error?: string; approvalId?: string },
  ): Promise<ProposalRecord | null> {
    const proposal = await this.load(runId, proposalId);
    if (!proposal) return null;
    if (proposal.status !== expectedStatus) return null;

    proposal.status = newStatus;
    proposal.updatedAt = new Date().toISOString();
    if (extra?.error !== undefined) proposal.error = extra.error;
    if (extra?.approvalId !== undefined) proposal.approvalId = extra.approvalId;

    const path = this.proposalPath(runId, proposalId);
    const tmpPath = `${path}.tmp.${randomUUID()}`;
    await writeFile(tmpPath, JSON.stringify(proposal, null, 2), "utf-8");
    await renameFile(tmpPath, path);
    return proposal;
  }

  /**
   * Attach impact analysis to a proposal. Computes impactFingerprint.
   * Returns the updated proposal, or null if not found.
   */
  async attachImpactAnalysis(
    runId: string,
    proposalId: string,
    impactAnalysis: ImpactAnalysis,
  ): Promise<ProposalRecord | null> {
    const proposal = await this.load(runId, proposalId);
    if (!proposal) return null;

    proposal.impactAnalysis = impactAnalysis;
    proposal.impactFingerprint = computeFingerprint(impactAnalysis);
    proposal.updatedAt = new Date().toISOString();

    const path = this.proposalPath(runId, proposalId);
    const tmpPath = `${path}.tmp.${randomUUID()}`;
    await writeFile(tmpPath, JSON.stringify(proposal, null, 2), "utf-8");
    await renameFile(tmpPath, path);
    return proposal;
  }

  /**
   * Attach provider/model/usage metadata to a proposal.
   */
  async attachModelMetadata(
    runId: string,
    proposalId: string,
    metadata: { provider: string; model: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number } },
  ): Promise<ProposalRecord | null> {
    const proposal = await this.load(runId, proposalId);
    if (!proposal) return null;

    proposal.provider = metadata.provider;
    proposal.model = metadata.model;
    proposal.usage = metadata.usage;
    proposal.updatedAt = new Date().toISOString();

    const path = this.proposalPath(runId, proposalId);
    const tmpPath = `${path}.tmp.${randomUUID()}`;
    await writeFile(tmpPath, JSON.stringify(proposal, null, 2), "utf-8");
    await renameFile(tmpPath, path);
    return proposal;
  }

  /**
   * Delete a proposal.
   */
  async delete(runId: string, proposalId: string): Promise<boolean> {
    const path = this.proposalPath(runId, proposalId);
    if (!existsSync(path)) return false;
    await unlink(path);
    return true;
  }
}
