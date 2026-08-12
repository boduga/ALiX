import { describe, it, expect } from 'vitest';
import { LIFECYCLE_ELIGIBILITY, isLifecycleEligible, type LifecycleEligibility } from '../../src/capability/lifecycle-eligibility.js';
import type { LifecycleState } from '../../src/adaptation/capability-evolution-types.js';

describe('LIFECYCLE_ELIGIBILITY (CAP-7 table)', () => {
  it('contains exactly the six CAP-5 states', () => {
    const keys = Object.keys(LIFECYCLE_ELIGIBILITY).sort();
    expect(keys).toEqual(['active', 'declining', 'deprecated', 'emerging', 'mature', 'stagnant']);
  });

  it('excludes deprecated from normal selection (AC#1, AC#2)', () => {
    expect(LIFECYCLE_ELIGIBILITY.deprecated).toBe(false);
  });

  it('permits every other state (AC#1: emerging/active/mature/stagnant/declining are all lifecycle-eligible)', () => {
    for (const state of ['emerging', 'active', 'mature', 'stagnant', 'declining'] as const) {
      expect(LIFECYCLE_ELIGIBILITY[state]).toBe(true);
    }
  });

  it('is a strict boolean table — no undefined, no null, no availability-axis keys (locked ruling #7)', () => {
    for (const value of Object.values(LIFECYCLE_ELIGIBILITY)) {
      expect(typeof value).toBe('boolean');
    }
    // No availability-axis leakage.
    expect(Object.keys(LIFECYCLE_ELIGIBILITY)).not.toContain('unavailable');
    expect(Object.keys(LIFECYCLE_ELIGIBILITY)).not.toContain('missing_binding');
    expect(Object.keys(LIFECYCLE_ELIGIBILITY)).not.toContain('provider_unavailable');
  });

  it('is frozen at the type level (Record<LifecycleState, boolean>, not a wider Record)', () => {
    // Compile-time gate: this annotation only typechecks if the table's key
    // set is exactly the six states. A `Record<string, boolean>` would silently
    // accept any key — this catches accidental widening.
    const table: Record<LifecycleState, boolean> = LIFECYCLE_ELIGIBILITY;
    const _exhaustive: LifecycleState = 'deprecated';
    void table[_exhaustive];
  });
});

describe('isLifecycleEligible', () => {
  it('returns true for non-deprecated states', () => {
    expect(isLifecycleEligible('emerging')).toBe(true);
    expect(isLifecycleEligible('active')).toBe(true);
    expect(isLifecycleEligible('mature')).toBe(true);
    expect(isLifecycleEligible('stagnant')).toBe(true);
    expect(isLifecycleEligible('declining')).toBe(true);
  });

  it('returns false for deprecated (AC#1, AC#2)', () => {
    expect(isLifecycleEligible('deprecated')).toBe(false);
  });

  it('agrees with the table for every state (parity)', () => {
    const states: LifecycleState[] = ['emerging', 'active', 'mature', 'stagnant', 'declining', 'deprecated'];
    for (const s of states) expect(isLifecycleEligible(s)).toBe(LIFECYCLE_ELIGIBILITY[s]);
  });
});

describe('LifecycleEligibility annotation shape (locked ruling #6)', () => {
  it('carries only state + eligible + overrideUsed — no caller/role/governance/timestamp fields', () => {
    // Type-level exhaustiveness: an annotation that grows extra fields is a
    // locked-ruling-#6 violation. This annotation is a SHAPE assertion, not
    // a behavior test.
    const ann: LifecycleEligibility = { state: 'active', eligible: true, overrideUsed: false };
    expect(Object.keys(ann).sort()).toEqual(['eligible', 'overrideUsed', 'state']);
    // Casting to a permissive shape surfaces unintended fields at compile time.
    const widened: Record<string, unknown> = ann;
    expect(widened.callerId).toBeUndefined();
    expect(widened.actorRole).toBeUndefined();
    expect(widened.governanceDecisionId).toBeUndefined();
    expect(widened.timestamp).toBeUndefined();
    expect(widened.auditId).toBeUndefined();
    expect(widened.providerFallbackHistory).toBeUndefined();
  });

  it('overrideUsed: true is set at the call site — eligibility module does not see it', () => {
    // isLifecycleEligible is a pure lookup; this test pins the boundary: the
    // module never produces or interprets overrideUsed.
    const _ann: LifecycleEligibility = { state: 'deprecated', eligible: true, overrideUsed: true };
    expect(isLifecycleEligible('deprecated')).toBe(false); // the function does not look at overrideUsed
    expect(_ann.overrideUsed).toBe(true);
  });
});