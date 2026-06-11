/**
 * continuation-store.ts — File-backed persistence for pending continuation records.
 *
 * When PolicyGate returns "ask", ToolExecutor persists a PendingContinuation
 * so that approved tool calls can be resumed with argsHash integrity verification.
 *
 * File location: .alix/approvals/continuations.json
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

// ─── Types ───────────────────────────────────────────────────────────

export type PendingContinuation = {
  approvalId: string;
  kind: "tool" | "capability";
  sessionId: string;
  cwd: string;
  toolCall?: {
    toolCallId: string;
    name: string;
    capability: string;
    args: Record<string, unknown>;
    argsHash: string;
  };
  createdAt: string;
};

// ─── ContinuationStore ───────────────────────────────────────────────

export class ContinuationStore {
  private continuations: PendingContinuation[] = [];
  private dirty = false;
  private filePath: string;

  constructor(cwd: string) {
    this.filePath = join(cwd, ".alix", "approvals", "continuations.json");
  }

  /** Load continuations from disk. */
  async load(): Promise<void> {
    if (!existsSync(this.filePath)) {
      this.continuations = [];
      this.dirty = false;
      return;
    }
    try {
      const raw = await readFile(this.filePath, "utf-8");
      this.continuations = JSON.parse(raw);
      this.dirty = false;
    } catch {
      this.continuations = [];
      this.dirty = false;
    }
  }

  /** Persist to disk if dirty. */
  async save(): Promise<void> {
    if (!this.dirty) return;
    const dir = join(this.filePath, "..");
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(this.filePath, JSON.stringify(this.continuations, null, 2), "utf-8");
    this.dirty = false;
  }

  /** Add a new continuation record. */
  async persist(cont: PendingContinuation): Promise<void> {
    this.continuations.push(cont);
    this.dirty = true;
    await this.save();
  }

  /** Find a continuation by approval ID. */
  findByApprovalId(approvalId: string): PendingContinuation | undefined {
    return this.continuations.find(c => c.approvalId === approvalId);
  }

  /** Remove a continuation (one-shot — called after resume or denial). */
  async remove(approvalId: string): Promise<void> {
    this.continuations = this.continuations.filter(c => c.approvalId !== approvalId);
    this.dirty = true;
    await this.save();
  }

  /** List all continuations. */
  list(): PendingContinuation[] {
    return [...this.continuations];
  }
}
