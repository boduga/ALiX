// tests/tui/capabilities/integration.vitest.ts
import { describe, it, expect } from 'vitest';
import { CapabilityService, setCapabilityService, clearCapabilityService } from '../../../src/tui/capabilities/capability-service.js';
import { ChatInvocationPresenter } from '../../../src/tui/capabilities/invocation-presenter.js';
import { CapabilityProvider, PaletteModal } from '../../../src/tui/capabilities/palette.js';
import { createInitialTuiAppState, type TimelineEvent } from '../../../src/tui/state.js';

describe('capabilities integration', () => {
  it('query → palette → invoke → chat timeline end-to-end', async () => {
    clearCapabilityService();
    const state = createInitialTuiAppState();
    const presenter = new ChatInvocationPresenter(() => state.views.chat);
    const svc = new CapabilityService(presenter);
    setCapabilityService(svc);
    await svc.ready();

    // Palette search + invoke.
    const modal = new PaletteModal([new CapabilityProvider()]);
    modal.refresh('session');
    expect(modal.list.length).toBeGreaterThan(0);
    const entry = modal.list.find((e) => e.subtitle === 'core.session.list')!;
    entry.invoke();

    // The invocation presented into the chat timeline.
    const caps = state.views.chat.timelineEvents.filter(
      (e): e is Extract<TimelineEvent, { kind: 'capability' }> => e.kind === 'capability',
    );
    expect(caps.length).toBe(1);
    expect(caps[0]!.capabilityId).toBe('core.session.list');
    // Wait for the invocation to settle. Poll rather than fixed sleep: the
    // core.session.list native handler lists the session store on disk, so
    // settle time scales with the number of sessions (measured ~143ms cold
    // with the ~440 sessions in this repo).
    const deadline = Date.now() + 5_000;
    while (
      Date.now() < deadline &&
      !['completed', 'failed', 'cancelled'].includes(caps[0]!.status)
    ) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(['completed', 'failed']).toContain(caps[0]!.status);
  });
});
