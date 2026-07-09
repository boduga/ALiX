/**
 * P21 — Human Execution Closure Types.
 *
 * Pure types only — no filesystem, audit, CLI, or execution imports.
 */

export type HumanExecutionEvidenceKind =
  | "log_ref"
  | "screenshot_ref"
  | "pull_request_ref"
  | "issue_ref"
  | "incident_note_ref"
  | "terminal_transcript_ref"
  | "deployment_note_ref"
  | "rollback_note_ref"
  | "external_ticket_ref"
  | "manual_verification_note"
  | "other_ref";

export interface HumanExecutionEvidenceRef {
  evidenceId: string;
  handoffId: string;
  preparedRecordId: string | null;
  kind: HumanExecutionEvidenceKind;
  uri: string | null;
  label: string;
  summary: string;
  submittedBy: string;
  submittedAt: string;
  contentHash: string | null;
  auditRefs: string[];
}

export interface HumanExecutionEvidenceLedgerEntry {
  ledgerEntryId: string;
  handoffId: string;
  preparedRecordId: string | null;
  evidenceId: string;
  appendedAt: string;
  appendedBy: string;
  auditRefs: string[];
}
