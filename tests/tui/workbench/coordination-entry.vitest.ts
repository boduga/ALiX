import { describe, expect, it, vi } from 'vitest';
import { TerminalCanvas } from '../../../src/interfaces/tui/canvas.js';
import { WorkbenchStore } from '../../../src/interfaces/tui/workbench/app/workbench-store.js';
import { routeWorkbenchInput } from '../../../src/interfaces/tui/workbench/input/input-router.js';
import { paintCoordinationEntry, validateCoordinationObjective } from '../../../src/interfaces/tui/workbench/views/coordination-entry.js';
import { displayWidth } from '../../../src/interfaces/tui/terminal-text.js';

describe('isolated coordination objective', () => {
  it('edits complete graphemes without altering the foreground draft', () => {
    const store = new WorkbenchStore();
    store.dispatch({ type: 'composer.replace', text: 'foreground' });
    store.dispatch({ type: 'coordination.edit', edit: { type: 'composer.insert', text: '界é👩‍💻' } });
    store.dispatch({ type: 'coordination.edit', edit: { type: 'composer.move', direction: 'left' } });
    store.dispatch({ type: 'coordination.edit', edit: { type: 'composer.backspace' } });
    expect(store.snapshot().coordination.draft).toEqual({ text: '界👩‍💻', cursor: 1 });
    expect(store.snapshot().composer.text).toBe('foreground');
  });

  it('retains active ownership and objective across modal close, preventing draft edits while busy', () => {
    const store = new WorkbenchStore();
    store.dispatch({ type: 'drawer.toggle', drawer: 'agents' });
    store.dispatch({ type: 'overlay.toggle', overlay: 'coordination' });
    store.dispatch({ type: 'coordination.edit', edit: { type: 'composer.insert', text: 'Four reports' } });
    store.dispatch({ type: 'coordination.status', phase: 'submitting' });
    store.dispatch({ type: 'overlay.close' });
    store.dispatch({ type: 'coordination.edit', edit: { type: 'composer.insert', text: 'do not append' } });
    expect(store.snapshot().coordination).toEqual({ draft: { text: 'Four reports', cursor: 12 }, phase: 'submitting', message: undefined });
    expect(store.snapshot().focus).toBe('drawer');
  });

  it.each(['c', '/', '1', 'a', 'd'])('keeps %s as draft text without an approval', key => {
    const context = { turnActive: false, composerText: '', slashActive: false, coordinationOpen: true,
      transcriptMode: 'compact' as const, drawer: 'agents' as const, focus: 'modal' as const };
    expect(routeWorkbenchInput(key, context)).toEqual({ type: 'coordination.edit', edit: { type: 'composer.insert', text: key } });
    if (key === 'a' || key === 'd') expect(routeWorkbenchInput(key, { ...context, approvalPending: true }).type).toBe('approval.resolve');
  });

  it('validates blank, oversized and terminal-control objectives without rejecting multiline Unicode', () => {
    for (const text of ['', '  ', 'x'.repeat(12001), 'clear\x1b[2J', 'tabs\t']) expect(validateCoordinationObjective(text)).toBeTruthy();
    expect(validateCoordinationObjective('Review café é 界 👩‍💻\nThen summarize')).toBeUndefined();
  });

  it.each([[200, 44], [134, 33], [80, 24], [40, 10], [10, 8], [1, 1]])('bounds painting and caret at %s×%s', (width, height) => {
    const canvas = new TerminalCanvas(width, height);
    const write = vi.spyOn(canvas, 'write');
    const text = '界é👩‍💻'.repeat(100);
    const caret = paintCoordinationEntry({ canvas, width, height, headerH: Math.min(3, height), footerH: 2 },
      { draft: { text, cursor: text.length }, phase: 'idle' }, 'ask');
    for (const [x, y, value] of write.mock.calls) {
      expect(x).toBeGreaterThanOrEqual(0); expect(y).toBeGreaterThanOrEqual(0);
      expect(x + displayWidth(value.replace(/\x1b\[[0-9;]*m/g, ''))).toBeLessThanOrEqual(width);
      expect(y).toBeLessThan(height - 2);
    }
    if (caret) {
      expect(caret.column).toBeGreaterThanOrEqual(0); expect(caret.column).toBeLessThan(width);
      expect(caret.row).toBeLessThan(height - 2);
    }
  });
});
