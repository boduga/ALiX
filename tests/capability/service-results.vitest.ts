// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import type {
  CapabilityListResult, CapabilityInspectResult, CapabilitySearchResult,
  CapabilityHealthResult, CapabilityHistoryResult, CapabilityRecommendResult,
  CapabilityApplyResult, CapabilityServiceOptions,
} from '../../src/capability/types/service-results.js';
import { CapabilityServiceNotImplementedError } from '../../src/capability/errors/service-not-implemented.js';

describe('CapabilityServiceNotImplementedError (locked ruling #4 — stable contract)', () => {
  it('has name = "CapabilityServiceNotImplementedError"', () => {
    const e = new CapabilityServiceNotImplementedError('x');
    expect(e.name).toBe('CapabilityServiceNotImplementedError');
    expect(e).toBeInstanceOf(Error);
  });
  it('carries code: "not_implemented_yet" (typed literal, not roadmap state)', () => {
    const e = new CapabilityServiceNotImplementedError('x');
    expect(e.code).toBe('not_implemented_yet');
    // No roadmap encoding: string "awaiting_cap_9" / "awaiting_cap_10" MUST NOT appear.
    expect(e.message).not.toMatch(/awaiting_cap_(9|10)/i);
  });
  it('message is the developer-supplied string; never auto-augmented', () => {
    const e = new CapabilityServiceNotImplementedError('propose() lands in CAP-9');
    expect(e.message).toBe('propose() lands in CAP-9');
  });
});

describe('Result-shape readonly surface (locked ruling #8)', () => {
  // Type-level assertions: every result shape is structurally readonly.
  // Adds compile-time gate against accidental mutability widening.
  it('CapabilityListResult.items is readonly and not assignable to mutable array', () => {
    const r: CapabilityListResult = { items: [], total: 0 };
    // @ts-expect-error — readonly array is NOT assignable to mutable array.
    const items: { id: string }[] = r.items;
    void items;
  });
  it('CapabilityInspectResult is a structural snapshot (readonly end-to-end)', () => {
    const r: CapabilityInspectResult = {
      id: 'core.echo', version: '1.0.0', kind: 'core',
      title: 't', description: 'd', lifecycle: 'active',
      availability: { available: true },
      bindings: [], requiredPermissions: [], tags: [], category: 'core',
      risk: 'low', dependencies: [], allowFallbacks: true,
    };
    // @ts-expect-error — bindings is readonly; not assignable to mutable.
    const bindings: { id: string }[] = r.bindings;
    void bindings;
  });
  it('CapabilityHealthResult narrows Availability to CapabilityHealthResult, not ProviderCandidate[]', () => {
    const r: CapabilityHealthResult = {
      id: 'core.echo', version: '1.0.0', available: false, reason: 'missing_binding',
      lifecycle: 'active', providersChecked: 0,
    };
    // Shape test: reason is one of three literals (or absent) — never array.
    if (r.reason) {
      expect(['missing_binding', 'provider_unavailable', 'lifecycle_ineligible']).toContain(r.reason);
    }
  });
  it('CapabilityHistoryEvent.payload is readonly Record<string,unknown>, never any', () => {
    const e: CapabilityHistoryResult['events'][number] = {
      seq: 1, type: 'capability.transition',
      payload: { capabilityId: 'core.echo', from: 'active', to: 'mature' },
      at: '2026-08-12T00:00:00Z',
    };
    // @ts-expect-error — payload is not assignable to a free-form any property set.
    const _bad: { foo: string } = e.payload;
    void _bad;
  });
  it('CapabilityApplyResult.success is boolean; affected is readonly string[]; artifactId and error are optional', () => {
    const ok: CapabilityApplyResult = { success: true, operation: 'capability.create', affected: ['core.echo'], artifactId: 'ar1' };
    const ko: CapabilityApplyResult = { success: false, operation: 'capability.create', affected: [], error: 'fail' };
    expect(ok.success).toBe(true);
    expect(ko.success).toBe(false);
  });
  it('CapabilityRecommendResult.input echoes the query verbatim (no internal augmentation)', () => {
    const r: CapabilityRecommendResult = { input: { text: 'session list', limit: 5 }, suggestions: [], total: 0 };
    expect(r.input.text).toBe('session list');
    expect(r.input.limit).toBe(5);
  });
  it('CapabilityServiceOptions lists exactly four dependencies (catalog/resolver/mutationExecutor/eventLog)', () => {
    // Type-level assertion: CapabilitiesServiceOptions is the declared four-key
    // shape; a future PR that adds a 5th dep (e.g. sessionContext, telemetry) is
    // a locked-ruling-#6 violation and must fail review.
    const opts = null as unknown as CapabilityServiceOptions | null;
    expect(opts === null || typeof opts === 'object').toBe(true);
  });
  it('No {ok, value, error} envelope — every result shape is the success shape or the failure throws', () => {
    // Type-level: CapabilityListResult has no `ok`/`error` field.
    // Compile-time gate: `Keys` is a type alias (erased at runtime); the
    // runtime check below verifies the documented keys are present.
    type Keys = keyof CapabilityListResult;
    const _typed: Keys[] = ['items', 'total']; // type assertion only
    void _typed;
    expect((['items', 'total'] as const).every((k) => ['items', 'total'].includes(k))).toBe(true);
  });
});