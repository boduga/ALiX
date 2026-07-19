import { describe, it, expect } from 'vitest';
import { PolicyView } from '../../../src/tui/views/policy-view.js';

describe('PolicyView', () => {
  const ctx = (snap: any = null) => ({
    snap: snap ?? { generatedAt: 1, session: null, daemon: null, approvals: null, runtime: null, sops: null, policy: null },
    dimensions: { columns: 100, rows: 30 },
    perTab: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0,
            inputBuffer: '',
            submittedPrompts: []
          },
  });

  it('renders strict-mode banner when enforcementMode=strict', () => {
    const view = new PolicyView();
    const snap = {
      generatedAt: 1, session: null, daemon: null, approvals: null, runtime: null, sops: null,
      policy: {
        rules: [], violations: [], enforcementMode: 'strict' as const, recentViolationCount: 0,
      },
    };
    const out = view.render(ctx(snap));
    expect(out.rows.some((r) => /strict/i.test(r))).toBe(true);
  });

  it('renders rules with severity and result and violation count', () => {
    const view = new PolicyView();
    const snap = {
      generatedAt: 1, session: null, daemon: null, approvals: null, runtime: null, sops: null,
      policy: {
        rules: [
          { id: 'R01', name: 'Require Approval', severity: 'high' as const, lastEvaluatedAt: 1, lastResult: 'pass' as const },
          { id: 'R02', name: 'Audit Log', severity: 'critical' as const, lastEvaluatedAt: 2, lastResult: 'fail' as const },
        ],
        violations: [], enforcementMode: 'auto' as const, recentViolationCount: 3,
      },
    };
    const out = view.render(ctx(snap));
    expect(out.rows.some((r) => /R01/.test(r))).toBe(true);
    expect(out.rows.some((r) => /R02/.test(r))).toBe(true);
    expect(out.rows.some((r) => /\b3\b/.test(r))).toBe(true);
  });

  it('shows unavailable state when policy is null', () => {
    const view = new PolicyView();
    const out = view.render(ctx());
    expect(out.rows.some((r) => /policy engine unavailable/i.test(r))).toBe(true);
  });

  it('handleKey returns moveCursor on arrows and handled on /', () => {
    const view = new PolicyView();
    const baseCtx = {
      snap: ctx().snap,
      dimensions: { columns: 100, rows: 30 },
      perTab: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0,
            inputBuffer: '',
            submittedPrompts: []
          },
    };
    expect(view.handleKey?.('ArrowDown', baseCtx)).toEqual({ type: 'moveCursor', cursor: 1 });
    expect(view.handleKey?.('ArrowUp', baseCtx)).toEqual({ type: 'moveCursor', cursor: 0 });
    expect(view.handleKey?.('/', baseCtx)).toEqual({ type: 'handled' });
  });
});
