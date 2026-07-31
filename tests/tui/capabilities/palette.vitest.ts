// tests/tui/capabilities/palette.vitest.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CapabilityProvider, PaletteModal, type PaletteEntry } from '../../../src/tui/capabilities/palette.js';
import { CapabilityService, setCapabilityService, clearCapabilityService } from '../../../src/tui/capabilities/capability-service.js';
import type { InvocationPresenter } from '../../../src/tui/capabilities/invocation-presenter.js';

function makeService(): CapabilityService {
  const presenter: InvocationPresenter = { present: vi.fn(async () => {}) };
  return new CapabilityService(presenter);
}

describe('CapabilityProvider', () => {
  beforeEach(() => { clearCapabilityService(); });

  it('lists all capabilities on empty query', () => {
    const svc = makeService();
    setCapabilityService(svc);
    const provider = new CapabilityProvider();
    const entries = provider.search('');
    expect(entries.length).toBeGreaterThanOrEqual(4);
    expect(entries.every(e => e.title.length > 0)).toBe(true);
  });

  it('subsequence-fuzzy-filters by title and id', () => {
    const svc = makeService();
    setCapabilityService(svc);
    const provider = new CapabilityProvider();
    expect(provider.search('session').some(e => e.subtitle?.includes('core.session'))).toBe(true);
    // Subsequence match: 'cslist' → core.session.list.
    expect(provider.search('cslist').some(e => e.subtitle === 'core.session.list')).toBe(true);
    expect(provider.search('zzznomatch')).toEqual([]);
  });

  it('entry invoke() calls service.invoke', () => {
    const svc = makeService();
    setCapabilityService(svc);
    const spy = vi.spyOn(svc, 'invoke');
    const provider = new CapabilityProvider();
    const entries = provider.search('core.session.list');
    entries[0]!.invoke();
    expect(spy).toHaveBeenCalledWith('core.session.list', {});
  });
});

describe('PaletteModal', () => {
  it('navigates and selects entries', () => {
    const modal = new PaletteModal();
    modal.setEntries([
      { id: 'a', title: 'Alpha', invoke: () => {} },
      { id: 'b', title: 'Beta', invoke: () => {} },
    ]);
    expect(modal.selected().id).toBe('a');
    modal.move(1);
    expect(modal.selected().id).toBe('b');
  });
});
