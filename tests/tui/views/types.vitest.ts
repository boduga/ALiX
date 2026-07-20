import { describe, it, expect } from 'vitest';
import type { TuiView, ViewRenderContext, ViewInputContext, ViewRenderResult, TerminalDimensions } from '../../../src/tui/views/types.js';

describe('TuiView contract — render purity', () => {
  it('render returns the same rows for the same context', () => {
    const fakeView: TuiView = {
      id: 'runtime',
      render: (ctx): ViewRenderResult => ({ rows: [`${ctx.snap.session!.phase}-${ctx.perTab.scrollOffset}`] }),
    };
    const ctx: ViewRenderContext = {
      snap: { session: { phase: 'Executing' as any, mode: 'auto' as any, version: '1', startedAt: 0, turns: 0 } as any } as any,
      dimensions: { columns: 80, rows: 24 },
      perTab: { cursor: 0, scrollOffset: 7, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0,
            inputBuffer: '',
            pinnedBottom: true,
            submittedPrompts: [],
            agentResponses: []
          },
    };
    const a = fakeView.render(ctx);
    const b = fakeView.render(ctx);
    expect(a.rows).toEqual(b.rows);
  });

  it('perTab is Readonly at the render boundary', () => {
    // Compile-time regression guard: if `perTab` ever loses its `Readonly<>`
    // wrapper, the assignment below would succeed and `@ts-expect-error`
    // would fail typecheck. The line is wrapped in a try/catch so the
    // runtime never throws — the check is purely structural at the type
    // level.
    const ctx: ViewRenderContext = {
      snap: null as any,
      dimensions: { columns: 80, rows: 24 },
      perTab: { cursor: 0, scrollOffset: 0, searchQuery: '', expandedSections: [], lastEventArrivedAt: 0,
            inputBuffer: '',
            pinnedBottom: true,
            submittedPrompts: [],
            agentResponses: []
          },
    };
    try {
      // @ts-expect-error — perTab is Readonly<PerTabState>; assignment fails at compile time
      ctx.perTab.scrollOffset = 1;
    } catch {
      // never expected at runtime in TS strict; defensive only.
    }
    expect(ctx).toBeDefined();
  });
});

describe('TuiView contract — handleKey is optional', () => {
  it('a view without handleKey still renders', () => {
    const minimalView: TuiView = { id: 'chat', render: () => ({ rows: [] }) };
    const ctx: ViewRenderContext = null as any;
    expect(minimalView.render(ctx)).toEqual({ rows: [] });
  });
});

describe('ViewAction discriminated union', () => {
  it('lists every action variant explicitly', () => {
    const handled = { type: 'handled' as const };
    const move = { type: 'moveCursor' as const, cursor: 5 };
    const refresh = { type: 'scheduleRefresh' as const };
    const switchTab = { type: 'switchTab' as const, tab: 'runtime' as const };
    for (const a of [handled, move, refresh, switchTab]) expect(a.type).toBeDefined();
  });
});

describe('TerminalDimensions', () => {
  it('exposes columns and rows', () => {
    const d: TerminalDimensions = { columns: 120, rows: 40 };
    expect(d.columns).toBe(120);
    expect(d.rows).toBe(40);
  });
});
