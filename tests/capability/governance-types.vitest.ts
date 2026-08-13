// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-9 Task 1 — Governance event types + result type projections.
 *
 * Asserts the five-event discriminated union, the shared governance prefix
 * (ruling #1), the projection helper, and the three CAP-9 service result
 * shapes (ruling #3, #4, #22).
 */

import { describe, it, expect } from 'vitest';
import {
  CAPABILITY_GOVERNANCE_EVENT_TYPES,
  CAPABILITY_GOVERNANCE_EVENT_SHORT_TYPES,
  GOVERNANCE_EVENT_PREFIX,
  isGovernanceEventType,
  projectCapabilityMutationResult,
  type CapabilityGovernanceEvent,
  type CapabilityGovernanceEventType,
  type CapabilityGovernanceEventProjection,
  type CapabilityMutationResult,
} from '../../src/capability/governance/governance-types.js';
import {
  type CapabilityProposeResult,
  type CapabilityApplyProposalResult,
  type CapabilityGovernanceResult,
} from '../../src/capability/types/service-results.js';
import type { CapabilityEvolutionCandidate } from '../../src/adaptation/capability-evolution-types.js';
import type { ExecutionStepResult } from '../../src/evolution/execution/contracts/execution-contract.js';

function mkCandidate(): CapabilityEvolutionCandidate {
  return {
    candidateId: 'c-1',
    sourcePatternId: 'p-gap-1',
    confidence: 0.85,
    target: { kind: 'capability', id: 'tool.file.read' },
    description: 'Add capability to read files',
    expectedEffect: 'Improved file workflow',
    riskClass: 'low',
    evidenceIds: ['e-1', 'e-2'],
  };
}

describe('CAPABILITY_GOVERNANCE_EVENT_TYPES (ruling #2)', () => {
  it('contains exactly the five canonical long-form event types', () => {
    expect([...CAPABILITY_GOVERNANCE_EVENT_TYPES]).toEqual([
      'capability.governance.proposal.submitted',
      'capability.governance.proposal.approved',
      'capability.governance.proposal.rejected',
      'capability.governance.proposal.executed',
      'capability.governance.proposal.execution_failed',
    ]);
  });

  it('is typed as readonly array of CapabilityGovernanceEventType', () => {
    const values: readonly CapabilityGovernanceEventType[] = CAPABILITY_GOVERNANCE_EVENT_TYPES;
    expect(values.length).toBe(5);
  });

  it('CAPABILITY_GOVERNANCE_EVENT_SHORT_TYPES mirrors the short form', () => {
    expect([...CAPABILITY_GOVERNANCE_EVENT_SHORT_TYPES]).toEqual([
      'proposal.submitted',
      'proposal.approved',
      'proposal.rejected',
      'proposal.executed',
      'proposal.execution_failed',
    ]);
  });
});

describe('GOVERNANCE_EVENT_PREFIX (ruling #1)', () => {
  it('is exactly the locked capability.governance.proposal. prefix', () => {
    expect(GOVERNANCE_EVENT_PREFIX).toBe('capability.governance.proposal.');
  });

  it('every canonical event type begins with the shared prefix', () => {
    for (const t of CAPABILITY_GOVERNANCE_EVENT_TYPES) {
      expect(t.startsWith(GOVERNANCE_EVENT_PREFIX)).toBe(true);
    }
  });
});

describe('isGovernanceEventType — runtime guard', () => {
  it('accepts every canonical event type', () => {
    for (const t of CAPABILITY_GOVERNANCE_EVENT_TYPES) {
      expect(isGovernanceEventType(t)).toBe(true);
    }
  });

  it('rejects unrelated strings', () => {
    expect(isGovernanceEventType('capability.created')).toBe(false);
    expect(isGovernanceEventType('proposal.submitted')).toBe(false);
    expect(isGovernanceEventType('')).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(isGovernanceEventType(undefined)).toBe(false);
    expect(isGovernanceEventType(null)).toBe(false);
    expect(isGovernanceEventType(42)).toBe(false);
    expect(isGovernanceEventType({ kind: 'capability.governance.proposal.submitted' })).toBe(false);
  });
});

describe('CapabilityGovernanceEvent discriminated union', () => {
  it('proposal.submitted variant carries candidate + signalIds', () => {
    const e: CapabilityGovernanceEvent = {
      seq: 1,
      timestamp: '2026-08-13T00:00:00.000Z',
      proposalId: 'p-1',
      type: 'capability.governance.proposal.submitted',
      payload: { candidate: mkCandidate(), signalIds: ['s-1'] },
    };
    expect(e.type).toBe('capability.governance.proposal.submitted');
    if (e.type === 'capability.governance.proposal.submitted') {
      expect(e.payload.candidate.candidateId).toBe('c-1');
      expect(e.payload.signalIds).toEqual(['s-1']);
    }
  });

  it('proposal.approved variant carries approvedBy + approvedAt', () => {
    const e: CapabilityGovernanceEvent = {
      seq: 2,
      timestamp: '2026-08-13T00:00:01.000Z',
      proposalId: 'p-1',
      type: 'capability.governance.proposal.approved',
      payload: { approvedBy: 'human:bob', approvedAt: '2026-08-13T00:00:01.000Z' },
    };
    expect(e.payload.approvedBy).toBe('human:bob');
  });

  it('proposal.rejected variant carries rejectedBy + reason', () => {
    const e: CapabilityGovernanceEvent = {
      seq: 3,
      timestamp: '2026-08-13T00:00:02.000Z',
      proposalId: 'p-1',
      type: 'capability.governance.proposal.rejected',
      payload: { rejectedBy: 'human:alice', reason: 'Insufficient evidence' },
    };
    expect(e.payload.reason).toMatch(/insufficient/i);
  });

  it('proposal.executed variant carries mutation + artifactId', () => {
    const mutation: CapabilityMutationResult = {
      success: true,
      mutation: { operation: 'capability.transition' },
      artifactId: 'a'.repeat(64),
    };
    const e: CapabilityGovernanceEvent = {
      seq: 4,
      timestamp: '2026-08-13T00:00:03.000Z',
      proposalId: 'p-1',
      type: 'capability.governance.proposal.executed',
      payload: { mutation, artifactId: mutation.artifactId },
    };
    expect(e.payload.artifactId).toMatch(/^[0-9a-f]{64}$/);
    expect(e.payload.mutation.success).toBe(true);
  });

  it('proposal.execution_failed variant carries error + optional partialState', () => {
    const e1: CapabilityGovernanceEvent = {
      seq: 5,
      timestamp: '2026-08-13T00:00:04.000Z',
      proposalId: 'p-1',
      type: 'capability.governance.proposal.execution_failed',
      payload: { error: 'Executor timeout', partialState: 'rolled_back' },
    };
    expect(e1.payload.partialState).toBe('rolled_back');

    const e2: CapabilityGovernanceEvent = {
      seq: 6,
      timestamp: '2026-08-13T00:00:05.000Z',
      proposalId: 'p-2',
      type: 'capability.governance.proposal.execution_failed',
      payload: { error: 'Pre-flight validation failed', partialState: 'not_committed' },
    };
    expect(e2.payload.partialState).toBe('not_committed');
  });
});

describe('CapabilityGovernanceEventProjection — application-facing shape', () => {
  it('exposes readonly seq/timestamp/proposalId/type/payload', () => {
    const projection: CapabilityGovernanceEventProjection = {
      seq: 7,
      timestamp: '2026-08-13T00:00:06.000Z',
      proposalId: 'p-1',
      type: 'capability.governance.proposal.submitted',
      payload: { candidate: mkCandidate(), signalIds: ['s-1'] },
    };
    expect(projection.seq).toBe(7);
    expect(projection.type).toBe('capability.governance.proposal.submitted');
  });
});

describe('CapabilityProposeResult (ruling #3)', () => {
  it('returns proposalId + status:pending + candidate', () => {
    const candidate = mkCandidate();
    const r: CapabilityProposeResult = {
      proposalId: 'p-1',
      status: 'pending',
      candidate,
    };
    expect(r.status).toBe('pending');
    expect(r.proposalId).toBe('p-1');
    expect(r.candidate.candidateId).toBe('c-1');
  });
});

describe('CapabilityApplyProposalResult (ruling #4)', () => {
  it('executed branch carries mutation', () => {
    const mutation: CapabilityMutationResult = {
      success: true,
      mutation: { operation: 'capability.create' },
      artifactId: 'b'.repeat(64),
    };
    const r: CapabilityApplyProposalResult = {
      proposalId: 'p-1',
      status: 'executed',
      mutation,
    };
    expect(r.status).toBe('executed');
    expect(r.mutation?.artifactId).toMatch(/^[0-9a-f]{64}$/);
  });

  it('execution_failed branch carries error', () => {
    const r: CapabilityApplyProposalResult = {
      proposalId: 'p-1',
      status: 'execution_failed',
      error: 'Pre-flight rejected',
    };
    expect(r.status).toBe('execution_failed');
    expect(r.error).toMatch(/rejected/);
    expect(r.mutation).toBeUndefined();
  });
});

describe('CapabilityGovernanceResult (ruling #22)', () => {
  it('wraps readonly projections array', () => {
    const projections: ReadonlyArray<CapabilityGovernanceEventProjection> = [
      {
        seq: 1,
        timestamp: '2026-08-13T00:00:00.000Z',
        proposalId: 'p-1',
        type: 'capability.governance.proposal.submitted',
        payload: { candidate: mkCandidate(), signalIds: [] },
      },
    ];
    const r: CapabilityGovernanceResult = { events: projections };
    expect(r.events).toHaveLength(1);
  });

  it('accepts empty events array', () => {
    const r: CapabilityGovernanceResult = { events: [] };
    expect(r.events).toEqual([]);
  });
});

describe('projectCapabilityMutationResult (CAP-6 nested output, F1 regression)', () => {
  it('reads CAP-6 nested output correctly (success path)', () => {
    const execResult: ExecutionStepResult = {
      stepId: 's1',
      success: true,
      output: {
        operation: 'capability.create',
        mutation: { operation: 'capability.create', capabilityId: 'x', version: '1.0.0', definition: {} },
        result: { artifactId: 'abc123'.padEnd(64, '0'), mutation: {}, preState: {}, post: {} },
      },
      startedAt: '2026-08-13T00:00:00Z',
      completedAt: '2026-08-13T00:00:01Z',
    };
    const projected = projectCapabilityMutationResult(execResult);
    expect(projected.success).toBe(true);
    expect(projected.mutation).toEqual({
      operation: 'capability.create',
      capabilityId: 'x',
      version: '1.0.0',
      definition: {},
    });
    expect(projected.artifactId).toBe('abc123'.padEnd(64, '0'));
    expect(projected.error).toBeUndefined();
  });

  it('falls back to empty artifactId when result envelope is missing', () => {
    const execResult: ExecutionStepResult = {
      stepId: 's2',
      success: true,
      output: { operation: 'capability.create', mutation: { capabilityId: 'x' } },
      startedAt: '2026-08-13T00:00:00Z',
      completedAt: '2026-08-13T00:00:01Z',
    };
    const projected = projectCapabilityMutationResult(execResult);
    expect(projected.success).toBe(true);
    expect(projected.mutation).toEqual({ capabilityId: 'x' });
    expect(projected.artifactId).toBe('');
    expect(projected.error).toBeUndefined();
  });

  it('propagates error string on failure path', () => {
    const execResult: ExecutionStepResult = {
      stepId: 's3',
      success: false,
      output: {},
      error: 'capability.update: sourceVersion mismatch',
      startedAt: '2026-08-13T00:00:00Z',
      completedAt: '2026-08-13T00:00:01Z',
    };
    const projected = projectCapabilityMutationResult(execResult);
    expect(projected.success).toBe(false);
    expect(projected.error).toBe('capability.update: sourceVersion mismatch');
    expect(projected.artifactId).toBe('');
    expect(projected.mutation).toEqual({});
  });

  it('result is deeply frozen', () => {
    const execResult: ExecutionStepResult = {
      stepId: 's4',
      success: true,
      output: {
        operation: 'capability.create',
        mutation: { capabilityId: 'x' },
        result: { artifactId: 'a' },
      },
      startedAt: '2026-08-13T00:00:00Z',
      completedAt: '2026-08-13T00:00:01Z',
    };
    const projected = projectCapabilityMutationResult(execResult);
    expect(Object.isFrozen(projected)).toBe(true);
  });
});
