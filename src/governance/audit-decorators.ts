/**
 * P14.6b — Store-Level Audit Decorators.
 *
 * Wraps each governance store interface with audit emission at the method level,
 * ensuring every write path captures an audit event regardless of the caller
 * (CLI handler, programmatic caller, API layer, or future automation).
 *
 * Decorator invariant (all four follow the same pattern):
 *   1. Delegate to inner store first (write may throw — do NOT catch)
 *   2. On success, emit audit event via the corresponding emitter factory
 *   3. Audit append failures are non-fatal (caught silently)
 *   4. Read methods pass through directly (no audit emission for reads)
 *
 * Strategy: Option A — decorators only, no CLI rewiring. P14.6a CLI appends
 * remain in place until P14.6c migrates them to use decorated stores.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import type { SignalStore, GovernanceSignal } from "./governance-signal.js";
import type { DecisionStore, OperatorDecision } from "./decision-capture.js";
import type {
  ActionQueueStore,
  GovernanceActionProposal,
  ActionProposalStatusTransition,
} from "./action-queue.js";
import type { ReviewStore, OperatorReview } from "./operator-review.js";
import type { AuditStore } from "./audit-store.js";
import {
  signalEvaluatedEvent,
  decisionRecordedEvent,
  actionProposedEvent,
  actionOverriddenEvent,
  reviewSubmittedEvent,
} from "./audit-emitters.js";

// ---------------------------------------------------------------------------
// AuditedSignalStore
// ---------------------------------------------------------------------------

export class AuditedSignalStore implements SignalStore {
  constructor(
    private readonly inner: SignalStore,
    private readonly auditStore: AuditStore,
  ) {}

  async append(signal: GovernanceSignal): Promise<void> {
    await this.inner.append(signal); // must propagate on failure

    try {
      await this.auditStore.append(signalEvaluatedEvent(signal));
    } catch {
      // Non-fatal — audit failure does not block governance
    }
  }

  async list(limit?: number): Promise<GovernanceSignal[]> {
    return this.inner.list(limit);
  }

  async getById(signalId: string): Promise<GovernanceSignal | null> {
    return this.inner.getById(signalId);
  }

  async query(filter: Partial<GovernanceSignal>): Promise<GovernanceSignal[]> {
    return this.inner.query(filter);
  }
}

// ---------------------------------------------------------------------------
// AuditedDecisionStore
// ---------------------------------------------------------------------------

export class AuditedDecisionStore implements DecisionStore {
  constructor(
    private readonly inner: DecisionStore,
    private readonly auditStore: AuditStore,
  ) {}

  async append(decision: OperatorDecision): Promise<void> {
    await this.inner.append(decision); // must propagate on failure

    try {
      await this.auditStore.append(decisionRecordedEvent(decision));
    } catch {
      // Non-fatal — audit failure does not block governance
    }
  }

  async list(limit?: number): Promise<OperatorDecision[]> {
    return this.inner.list(limit);
  }

  async getById(decisionId: string): Promise<OperatorDecision | null> {
    return this.inner.getById(decisionId);
  }

  async getBySignalId(signalId: string): Promise<OperatorDecision[]> {
    return this.inner.getBySignalId(signalId);
  }

  async getByKind(kind: import("./decision-capture.js").DecisionKind): Promise<OperatorDecision[]> {
    return this.inner.getByKind(kind);
  }
}

// ---------------------------------------------------------------------------
// AuditedActionQueueStore
// ---------------------------------------------------------------------------

export class AuditedActionQueueStore implements ActionQueueStore {
  constructor(
    private readonly inner: ActionQueueStore,
    private readonly auditStore: AuditStore,
  ) {}

  async append(proposal: GovernanceActionProposal): Promise<void> {
    await this.inner.append(proposal); // must propagate on failure

    try {
      await this.auditStore.append(actionProposedEvent(proposal));
    } catch {
      // Non-fatal — audit failure does not block governance
    }
  }

  async appendStatusTransition(transition: ActionProposalStatusTransition): Promise<void> {
    await this.inner.appendStatusTransition(transition); // must propagate on failure

    try {
      await this.auditStore.append(actionOverriddenEvent(transition));
    } catch {
      // Non-fatal — audit failure does not block governance
    }
  }

  async list(limit?: number): Promise<GovernanceActionProposal[]> {
    return this.inner.list(limit);
  }

  async getById(proposalId: string): Promise<GovernanceActionProposal | null> {
    return this.inner.getById(proposalId);
  }

  async getByDecisionId(decisionId: string): Promise<GovernanceActionProposal[]> {
    return this.inner.getByDecisionId(decisionId);
  }

  async getTransitions(proposalId: string): Promise<ActionProposalStatusTransition[]> {
    return this.inner.getTransitions(proposalId);
  }
}

// ---------------------------------------------------------------------------
// AuditedReviewStore
// ---------------------------------------------------------------------------

export class AuditedReviewStore implements ReviewStore {
  constructor(
    private readonly inner: ReviewStore,
    private readonly auditStore: AuditStore,
  ) {}

  async append(review: OperatorReview): Promise<void> {
    await this.inner.append(review); // must propagate on failure

    try {
      await this.auditStore.append(reviewSubmittedEvent(review));
    } catch {
      // Non-fatal — audit failure does not block governance
    }
  }

  async list(limit?: number): Promise<OperatorReview[]> {
    return this.inner.list(limit);
  }

  async getById(reviewId: string): Promise<OperatorReview | null> {
    return this.inner.getById(reviewId);
  }

  async getBySignalId(signalId: string): Promise<OperatorReview[]> {
    return this.inner.getBySignalId(signalId);
  }
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

export function auditSignalStore(inner: SignalStore, auditStore: AuditStore): SignalStore {
  return new AuditedSignalStore(inner, auditStore);
}

export function auditDecisionStore(inner: DecisionStore, auditStore: AuditStore): DecisionStore {
  return new AuditedDecisionStore(inner, auditStore);
}

export function auditActionQueueStore(
  inner: ActionQueueStore,
  auditStore: AuditStore,
): ActionQueueStore {
  return new AuditedActionQueueStore(inner, auditStore);
}

export function auditReviewStore(inner: ReviewStore, auditStore: AuditStore): ReviewStore {
  return new AuditedReviewStore(inner, auditStore);
}
