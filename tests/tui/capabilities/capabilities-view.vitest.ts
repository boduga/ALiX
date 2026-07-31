// tests/tui/capabilities/capabilities-view.vitest.ts
import { describe, it, expect, vi } from 'vitest';
import { CapabilitiesView } from '../../../src/tui/capabilities/capabilities-view.js';
import { CapabilityService, setCapabilityService, clearCapabilityService } from '../../../src/tui/capabilities/capability-service.js';
import { createInitialTuiAppState } from '../../../src/tui/state.js';
import { TerminalCanvas } from '../../../src/tui/canvas.js';
import type { InvocationPresenter } from '../../../src/tui/capabilities/invocation-presenter.js';

function setup() {
  clearCapabilityService();
  const presenter: InvocationPresenter = { present: vi.fn() };
  const svc = new CapabilityService(presenter);
  setCapabilityService(svc);
  return { svc };
}

describe('CapabilitiesView', () => {
  it('renders the catalog into the canvas', () => {
    setup();
    const view = new CapabilitiesView();
    const state = createInitialTuiAppState();
    const canvas = new TerminalCanvas(80, 24);
    const ctx = { snap: state.lastSnapshot, dimensions: { columns: 80, rows: 24 }, perTab: state.views.capabilities, canvas };
    view.render(ctx as never);
    const out = canvas.renderFrame();
    expect(out).toContain('core.session.list');
    expect(out).toContain('tool.file.read');
  });

  it('filters by query via ArrowUp/type', () => {
    setup();
    const view = new CapabilitiesView();
    const state = createInitialTuiAppState();
    // Simulate the view's own search query state by calling handleKey.
    const ctx = { snap: state.lastSnapshot, dimensions: { columns: 80, rows: 24 }, perTab: state.views.capabilities };
    view.handleKey('c', ctx as never);
    view.handleKey('o', ctx as never);
    const canvas = new TerminalCanvas(80, 24);
    view.render({ ...ctx, canvas } as never);
    expect(canvas.renderFrame()).toContain('core.session');
  });
});
