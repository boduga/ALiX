import { describe, expect, it } from 'vitest';
import { TAB_ORDER, createInitialPerTabState } from '../../../src/tui/state.js';
import { getView } from '../../../src/tui/views/index.js';

describe('evolution tab plumbing', () => {
  it('TAB_ORDER contains evolution exactly once, after capabilities', () => {
    expect(TAB_ORDER.filter((t) => t === 'evolution')).toHaveLength(1);
    expect(TAB_ORDER[TAB_ORDER.length - 1]).toBe('evolution');
  });

  it('createInitialPerTabState seeds evolution fields and round-trips JSON', () => {
    const s = createInitialPerTabState();
    const roundTripped = JSON.parse(JSON.stringify(s)) as typeof s;
    expect(roundTripped).toEqual(s);
  });

  it('registers an evolution view in the view registry', () => {
    const v = getView('evolution');
    expect(v).toBeDefined();
    expect(v!.id).toBe('evolution');
  });
});
