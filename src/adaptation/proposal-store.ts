import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { AdaptationProposal, ProposalStatus } from "./adaptation-types.js";

export class ProposalStore {
  constructor(private readonly dir: string) {}

  async save(proposal: AdaptationProposal): Promise<void> {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, `${proposal.id}.json`), JSON.stringify(proposal, null, 2), "utf-8");
  }

  async load(id: string): Promise<AdaptationProposal | null> {
    const path = join(this.dir, `${id}.json`);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8"));
  }

  async list(status?: ProposalStatus): Promise<AdaptationProposal[]> {
    if (!existsSync(this.dir)) return [];
    const files = readdirSync(this.dir).filter(f => f.endsWith(".json"));
    const proposals: AdaptationProposal[] = files.map(f =>
      JSON.parse(readFileSync(join(this.dir, f), "utf-8")) as AdaptationProposal
    );
    return status ? proposals.filter(p => p.status === status) : proposals;
  }

  async update(id: string, patch: Partial<AdaptationProposal>): Promise<AdaptationProposal> {
    const existing = await this.load(id);
    if (!existing) throw new Error(`Proposal not found: ${id}`);
    const updated = { ...existing, ...patch, id }; // id is immutable
    await this.save(updated);
    return updated;
  }
}
