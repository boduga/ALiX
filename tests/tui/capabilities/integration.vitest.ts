// tests/tui/capabilities/integration.vitest.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CapabilityService, setCapabilityService, clearCapabilityService } from '../../../src/tui/capabilities/capability-service.js';
import { ChatInvocationPresenter } from '../../../src/tui/capabilities/invocation-presenter.js';
import { CapabilityProvider, PaletteModal } from '../../../src/tui/capabilities/palette.js';
import { EventLog } from '../../../src/events/event-log.js';

describe('capabilities integration', () => {
  it('query → palette → invoke → chat log entry end-to-end', async () => {
    clearCapabilityService();
    const log = new EventLog(mkdtempSync(join(tmpdir(), 'alix-cap-int-')));
    await log.init();
    // Phase 6 (D9): the presenter no longer pushes into per-tab state — it
    // emits the settled chat.response into the chat sub-session's log
    // projection (the EventLog is the single source of truth timeline).
    const presenter = new ChatInvocationPresenter({ eventLog: log, sessionId: 'sess-chat' });
    const svc = new CapabilityService(presenter);
    setCapabilityService(svc);
    try {
      await svc.ready();

      // Palette search + invoke.
      const modal = new PaletteModal([new CapabilityProvider()]);
      modal.refresh('session');
      expect(modal.list.length).toBeGreaterThan(0);
      const entry = modal.list.find((e) => e.subtitle === 'core.session.list')!;

      // The presenter emits at settlement — set the flush watcher before
      // invoking so we catch the append deterministically.
      const flushed = new Promise<void>((resolve) => { log.watch(() => resolve()); });
      entry.invoke();
      await flushed;

      const events = await log.readAll();
      const text = (events.find((e) => e.type === 'chat.response')?.payload as { text?: string } | undefined)?.text ?? '';
      expect(text).toContain('core.session.list');
      // Settled to a terminal status. The native handler may fail if the
      // session store is unavailable, so accept completion or failure.
      expect(text).toMatch(/\[completed ✓\]|\[failed ✗\]/);
    } finally {
      clearCapabilityService();
    }
  });
});
