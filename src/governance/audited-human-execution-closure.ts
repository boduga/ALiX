/**
 * P21.3 — Audit-Safe Closure Recorder.
 *
 * Wraps P21.1/P21.2 stores with audit event emission and ref generation.
 * Pure validators and stores remain uncontaminated — audit wiring lives here.
 */

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { HumanExecutionEvidenceRef } from "./human-execution-closure-types.js";
import type { HumanExecutionClosureReview } from "./human-execution-closure-types.js";
import type { HumanExecutionEvidenceLedgerStore } from "./human-execution-evidence-ledger.js";
import type { HumanExecutionClosureReviewStore } from "./human-execution-closure-review.js";

export interface AuditEventRef {
  auditRef: string;
}

interface EvidenceAuditMetadata {
  handoffId: string;
  preparedRecordId: string | null;
  evidenceId: string;
  evidenceKind: string;
  hasUri: boolean;
  hasContentHash: boolean;
}

interface ReviewAuditMetadata {
  handoffId: string;
  preparedRecordId: string | null;
  closureReviewId: string;
  decision: string;
  evidenceCount: number;
  followUpRequired: boolean;
}

export class AuditedClosureRecorder {
  private evidenceStore: HumanExecutionEvidenceLedgerStore;
  private reviewStore: HumanExecutionClosureReviewStore;
  private auditStorePath: string;

  constructor(
    evidenceStore: HumanExecutionEvidenceLedgerStore,
    reviewStore: HumanExecutionClosureReviewStore,
    auditStorePath: string,
  ) {
    this.evidenceStore = evidenceStore;
    this.reviewStore = reviewStore;
    this.auditStorePath = auditStorePath;
    const dir = dirname(auditStorePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private emitAuditEvent(eventType: string, actorId: string, subjectId: string, metadata: Record<string, unknown>): string {
    const timestamp = new Date().toISOString();
    const auditRef = createHash("sha256")
      .update(["p21.3", eventType, subjectId, timestamp].join("|"))
      .digest("hex")
      .slice(0, 16);
    const event = {
      eventType,
      timestamp,
      auditRef,
      actorId,
      subjectId,
      metadata,
    };
    appendFileSync(this.auditStorePath, JSON.stringify(event) + "\n", "utf-8");
    return auditRef;
  }

  async appendEvidence(ref: HumanExecutionEvidenceRef): Promise<HumanExecutionEvidenceRef> {
    const auditRef = this.emitAuditEvent(
      "human_execution_evidence_appended",
      ref.submittedBy,
      ref.handoffId,
      {
        handoffId: ref.handoffId,
        preparedRecordId: ref.preparedRecordId,
        evidenceId: ref.evidenceId,
        evidenceKind: ref.kind,
        hasUri: ref.uri !== null,
        hasContentHash: ref.contentHash !== null,
      } satisfies EvidenceAuditMetadata,
    );
    const refWithAudit: HumanExecutionEvidenceRef = {
      ...ref,
      auditRefs: [...ref.auditRefs, auditRef],
    };
    return this.evidenceStore.appendEvidence(refWithAudit);
  }

  async appendReview(review: HumanExecutionClosureReview): Promise<HumanExecutionClosureReview> {
    const auditRef = this.emitAuditEvent(
      "human_execution_closure_reviewed",
      review.reviewedBy,
      review.handoffId,
      {
        handoffId: review.handoffId,
        preparedRecordId: review.preparedRecordId,
        closureReviewId: review.closureReviewId,
        decision: review.decision,
        evidenceCount: review.evidenceIds.length,
        followUpRequired: review.followUpRequired,
      } satisfies ReviewAuditMetadata,
    );
    const reviewWithAudit: HumanExecutionClosureReview = {
      ...review,
      auditRefs: [...review.auditRefs, auditRef],
    };
    return this.reviewStore.appendReview(reviewWithAudit);
  }
}
