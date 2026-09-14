import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ensureDirSync, readJsonFileSync, writeJsonFileAtomicSync } from "../storage/jsonl-store.js";
import { Either } from "effect";
import type { AdaptationProposal, ProposalStatus } from "./adaptation-types.js";
import type { Logger } from "../workflow/evidence-writer.js";
import { assertSafePathComponent } from "../security/path-assert.js";
import { decode, formatErrors } from "../contracts/helpers.js";
import { AdaptationProposalSchema } from "../contracts/proposal-schemas.js";
import { buildDiagnostic, type ContractDiagnostic } from "../contracts/contract-diagnostics.js";
import type { ExecutionContext } from "../observability/execution-context.js";

/**
 * AdaptationProposalStore — CRUD store for AdaptationProposal records
 * (file-per-proposal JSON under dir).
 *
 * Lifecycle vocabulary (#716): pending → approved|rejected → applied|failed.
 * This is a DIFFERENT lifecycle from the capability governance ledger
 * (GovernanceProposalStore: submitted → approved|rejected → executed|
 * execution_failed events). The two never convert: adaptation tracks
 * operator-proposal state, governance tracks capability-mutation history.
 * Rough correspondence for readers: submitted≈pending, executed≈applied,
 * execution_failed≈failed.
 */
export class AdaptationProposalStore {
  /** Decoded-record cache keyed by file path, invalidated by (mtime, size) (#704). */
  private readonly decodeCache = new Map<string, { mtimeMs: number; size: number; record: AdaptationProposal }>();

  constructor(
    private readonly dir: string,
    private readonly logger: Logger = { warn: (m, meta) => console.warn(m, meta ?? "") },
    private readonly onDiagnostic?: (diag: ContractDiagnostic) => void,
    private readonly context?: ExecutionContext,
  ) {}

  /** Validate that a proposal has the required structural fields. */
  private validateShape(proposal: AdaptationProposal, boundary: "proposal.save" | "proposal.load" | "proposal.list" = "proposal.save"): void {
    const errors: string[] = [];
    if (!proposal.id || typeof proposal.id !== "string") errors.push("id must be a non-empty string");
    if (!proposal.createdAt || typeof proposal.createdAt !== "string") errors.push("createdAt must be a string");
    if (!["pending", "approved", "rejected", "applied", "failed"].includes(proposal.status)) {
      errors.push(`invalid status: ${proposal.status}`);
    }
    if (!proposal.action || typeof proposal.action !== "string") errors.push("action must be a non-empty string");
    if (!proposal.target || typeof proposal.target !== "object" || !proposal.target.kind) {
      errors.push("target must be an object with a 'kind' field");
    }
    if (errors.length > 0) {
      const msg = `Proposal validation failed: ${errors.join("; ")}`;
      if (this.onDiagnostic) {
        this.onDiagnostic(buildDiagnostic("adaptation", boundary, "AdaptationProposalSchema", msg, proposal.id, this.context));
      }
      throw new Error(msg);
    }

    // -- Effect Schema validation (additional layer on top of manual checks)
    // Catches shape mismatches the manual checks miss: invalid ProposalAction
    // literal, invalid ProposalTarget discriminated union variant, invalid
    // ProposalStatus literal, invalid nested shapes.
    const schemaResult = decode(AdaptationProposalSchema, proposal);
    if (Either.isLeft(schemaResult)) {
      const msg = `Proposal schema validation failed: ${formatErrors(schemaResult.left)}`;
      if (this.onDiagnostic) {
        this.onDiagnostic(buildDiagnostic("adaptation", boundary, "AdaptationProposalSchema", msg, proposal.id, this.context));
      }
      throw new Error(msg);
    }
  }

  async save(proposal: AdaptationProposal): Promise<void> {
    assertSafePathComponent(proposal.id);
    this.validateShape(proposal, "proposal.save");
    ensureDirSync(this.dir);
    const path = join(this.dir, `${proposal.id}.json`);
    writeJsonFileAtomicSync(path, proposal);
    this.decodeCache.delete(path); // invalidate the decoded-record cache (#704)
  }

  async load(id: string): Promise<AdaptationProposal | null> {
    assertSafePathComponent(id);
    const raw = readJsonFileSync<AdaptationProposal>(join(this.dir, `${id}.json`));
    if (raw === null) return null;
    // Validate with Effect Schema — throw on invalid stored data
    // (semantically different from "not found" null return)
    this.validateShape(raw, "proposal.load");
    return raw;
  }

  async list(status?: ProposalStatus): Promise<AdaptationProposal[]> {
    if (!existsSync(this.dir)) return [];
    const files = readdirSync(this.dir).filter(f => f.endsWith(".json"));
    const proposals: AdaptationProposal[] = [];
    let corruptCount = 0;
    for (const f of files) {
      const path = join(this.dir, f);
      try {
        // Cache decoded records by (mtime, size) so unchanged files are
        // decoded once (#704). Corrupt files are not cached, so their
        // warning behavior is unchanged.
        let parsed: AdaptationProposal | null = null;
        let stat;
        try {
          stat = statSync(path);
        } catch {
          continue;
        }
        const hit = this.decodeCache.get(path);
        if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) {
          parsed = hit.record;
        } else {
          parsed = readJsonFileSync<AdaptationProposal>(path);
          if (parsed === null) continue;
          this.validateShape(parsed, "proposal.list");
          this.decodeCache.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, record: parsed });
        }
        // P9.2: skip orphaned proposals — they exist on disk for audit
        // but are not surfaced as normal pending proposals.
        if (parsed.systemState?.orphaned) continue;
        proposals.push(parsed);
      } catch {
        this.decodeCache.delete(path);
        corruptCount++;
        this.logger.warn(`[AdaptationProposalStore] Skipping corrupt proposal file: ${f}`);
      }
    }
    if (corruptCount > 0) {
      this.logger.warn(
        `[AdaptationProposalStore] ${corruptCount} corrupt file(s) skipped during list()`,
      );
    }
    return status ? proposals.filter(p => p.status === status) : proposals;
  }

  async update(id: string, patch: Partial<AdaptationProposal>): Promise<AdaptationProposal> {
    assertSafePathComponent(id);
    const existing = await this.load(id);
    if (!existing) throw new Error(`Proposal not found: ${id}`);
    const updated = { ...existing, ...patch, id }; // id is immutable
    this.validateShape(updated, "proposal.save");
    await this.save(updated);
    return updated;
  }

  /**
   * P9.2 atomicity recovery: mark a proposal as orphaned so it is
   * excluded from `list()`. Used when the EvidenceChain edge write
   * fails after the proposal is created. The proposal's lifecycle
   * status is preserved (typically "pending"); the systemState
   * field is set to indicate the infrastructure-recovery state.
   * The proposal still exists on disk for audit, but is not
   * surfaced as a normal pending proposal.
   */
  async markOrphaned(id: string, reason: string): Promise<void> {
    await this.update(id, { systemState: { orphaned: true, reason } } as any);
  }
}
