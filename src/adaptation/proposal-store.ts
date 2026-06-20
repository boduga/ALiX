import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { AdaptationProposal, ProposalStatus } from "./adaptation-types.js";
import type { Logger } from "../workflow/evidence-writer.js";
import { assertSafePathComponent } from "../security/path-assert.js";

export class ProposalStore {
  constructor(
    private readonly dir: string,
    private readonly logger: Logger = { warn: (m, meta) => console.warn(m, meta ?? "") },
  ) {}

  /** Validate that a proposal has the required structural fields. */
  private validateShape(proposal: AdaptationProposal): void {
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
      throw new Error(`Proposal validation failed: ${errors.join("; ")}`);
    }
  }

  async save(proposal: AdaptationProposal): Promise<void> {
    assertSafePathComponent(proposal.id);
    this.validateShape(proposal);
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, `${proposal.id}.json`), JSON.stringify(proposal, null, 2), "utf-8");
  }

  async load(id: string): Promise<AdaptationProposal | null> {
    assertSafePathComponent(id);
    const path = join(this.dir, `${id}.json`);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8"));
  }

  async list(status?: ProposalStatus): Promise<AdaptationProposal[]> {
    if (!existsSync(this.dir)) return [];
    const files = readdirSync(this.dir).filter(f => f.endsWith(".json"));
    const proposals: AdaptationProposal[] = [];
    let corruptCount = 0;
    for (const f of files) {
      try {
        const parsed = JSON.parse(
          readFileSync(join(this.dir, f), "utf-8"),
        ) as AdaptationProposal;
        proposals.push(parsed);
      } catch {
        corruptCount++;
        this.logger.warn(`[ProposalStore] Skipping corrupt proposal file: ${f}`);
      }
    }
    if (corruptCount > 0) {
      this.logger.warn(
        `[ProposalStore] ${corruptCount} corrupt file(s) skipped during list()`,
      );
    }
    return status ? proposals.filter(p => p.status === status) : proposals;
  }

  async update(id: string, patch: Partial<AdaptationProposal>): Promise<AdaptationProposal> {
    assertSafePathComponent(id);
    const existing = await this.load(id);
    if (!existing) throw new Error(`Proposal not found: ${id}`);
    const updated = { ...existing, ...patch, id }; // id is immutable
    this.validateShape(updated);
    await this.save(updated);
    return updated;
  }
}
