/**
 * P21.1 — Evidence Ledger Store.
 *
 * Append-only JSONL store for human-submitted post-handoff evidence refs.
 * No execution, no audit recorder — pure append-only persistence.
 */

import { createHash } from "node:crypto";
import { readFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  HumanExecutionEvidenceRef,
  HumanExecutionEvidenceKind,
} from "./human-execution-closure-types.js";

const VALID_KINDS: HumanExecutionEvidenceKind[] = [
  "log_ref", "screenshot_ref", "pull_request_ref", "issue_ref",
  "incident_note_ref", "terminal_transcript_ref", "deployment_note_ref",
  "rollback_note_ref", "external_ticket_ref", "manual_verification_note",
  "other_ref",
];

const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export class EvidenceLedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceLedgerError";
  }
}

export interface HumanExecutionEvidenceLedgerStore {
  appendEvidence(ref: HumanExecutionEvidenceRef): Promise<HumanExecutionEvidenceRef>;
  listEvidence(): Promise<HumanExecutionEvidenceRef[]>;
  listEvidenceForHandoff(handoffId: string): Promise<HumanExecutionEvidenceRef[]>;
}

export class FileEvidenceLedgerStore implements HumanExecutionEvidenceLedgerStore {
  private storePath: string;

  constructor(storePath: string) {
    this.storePath = storePath;
    const dir = dirname(storePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private validate(ref: HumanExecutionEvidenceRef): void {
    if (!ref.handoffId) throw new EvidenceLedgerError("handoffId is required");
    if (!ref.kind) throw new EvidenceLedgerError("kind is required");
    if (!VALID_KINDS.includes(ref.kind)) {
      throw new EvidenceLedgerError(`unknown evidence kind "${ref.kind}"`);
    }
    if (!ref.label) throw new EvidenceLedgerError("label must be non-empty");
    if (!ref.summary) throw new EvidenceLedgerError("summary must be non-empty");
    if (!ref.submittedBy) throw new EvidenceLedgerError("submittedBy must be non-empty");
    if (!ref.submittedAt) throw new EvidenceLedgerError("submittedAt is required");
    if (!ISO_TIMESTAMP_PATTERN.test(ref.submittedAt) || Number.isNaN(Date.parse(ref.submittedAt))) {
      throw new EvidenceLedgerError(`submittedAt must be valid ISO 8601, got "${ref.submittedAt}"`);
    }
    if (ref.kind !== "manual_verification_note" && !ref.uri) {
      throw new EvidenceLedgerError(`uri is required for evidence kind "${ref.kind}"`);
    }
    if (ref.contentHash !== null && ref.contentHash !== undefined && ref.contentHash.trim() === "") {
      throw new EvidenceLedgerError("contentHash must be non-empty when provided");
    }
  }

  private async loadAll(): Promise<HumanExecutionEvidenceRef[]> {
    if (!existsSync(this.storePath)) return [];
    const raw = readFileSync(this.storePath, "utf-8").trim();
    if (!raw) return [];
    return raw.split("\n").map((line) => JSON.parse(line) as HumanExecutionEvidenceRef);
  }

  private async existsDuplicate(handoffId: string, evidenceId: string): Promise<boolean> {
    const all = await this.loadAll();
    return all.some((e) => e.handoffId === handoffId && e.evidenceId === evidenceId);
  }

  async appendEvidence(ref: HumanExecutionEvidenceRef): Promise<HumanExecutionEvidenceRef> {
    this.validate(ref);

    if (await this.existsDuplicate(ref.handoffId, ref.evidenceId)) {
      throw new EvidenceLedgerError(
        `duplicate evidenceId "${ref.evidenceId}" for handoff "${ref.handoffId}"`,
      );
    }

    const line = JSON.stringify(ref) + "\n";
    appendFileSync(this.storePath, line, "utf-8");
    return ref;
  }

  async listEvidence(): Promise<HumanExecutionEvidenceRef[]> {
    return this.loadAll();
  }

  async listEvidenceForHandoff(handoffId: string): Promise<HumanExecutionEvidenceRef[]> {
    const all = await this.loadAll();
    return all
      .filter((e) => e.handoffId === handoffId)
      .sort(
        (a, b) =>
          a.submittedAt.localeCompare(b.submittedAt) ||
          a.evidenceId.localeCompare(b.evidenceId),
      );
  }
}
