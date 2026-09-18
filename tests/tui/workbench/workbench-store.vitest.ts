import { describe, expect, it } from 'vitest';
import { reduceWorkbenchUiState, WorkbenchStore } from '../../../src/tui/workbench/app/workbench-store.js';
import { createInitialWorkbenchUiState } from '../../../src/tui/workbench/model/ui-state.js';

describe('WorkbenchStore', () => {
  it('edits the composer immutably, including embedded newlines', () => {
    const initial = createInitialWorkbenchUiState();
    const typed = reduceWorkbenchUiState(initial, { type: 'composer.insert', text: 'first\nsecond' });
    const erased = reduceWorkbenchUiState(typed, { type: 'composer.backspace' });

    expect(initial.composer.text).toBe('');
    expect(typed.composer).toEqual({ text: 'first\nsecond', cursor: 12 });
    expect(erased.composer).toEqual({ text: 'first\nsecon', cursor: 11 });
  });

  it('backspaces one complete grapheme at a time', () => {
    const initial = createInitialWorkbenchUiState();
    const text = `A\u{1f469}\u200d\u{1f4bb}e\u0301`;
    const typed = reduceWorkbenchUiState(initial, { type: 'composer.insert', text });
    const withoutAccent = reduceWorkbenchUiState(typed, { type: 'composer.backspace' });
    const withoutEmoji = reduceWorkbenchUiState(withoutAccent, { type: 'composer.backspace' });

    expect(typed.composer).toEqual({ text, cursor: text.length });
    expect(withoutAccent.composer).toEqual({ text: `A\u{1f469}\u200d\u{1f4bb}`, cursor: `A\u{1f469}\u200d\u{1f4bb}`.length });
    expect(withoutEmoji.composer).toEqual({ text: 'A', cursor: 1 });
  });

  it('moves and edits at Unicode grapheme boundaries', () => {
    const store = new WorkbenchStore();
    const emoji = `\u{1f469}\u200d\u{1f4bb}`;
    store.dispatch({ type: 'composer.insert', text: `A${emoji}B` });
    store.dispatch({ type: 'composer.move', direction: 'left' });
    store.dispatch({ type: 'composer.move', direction: 'left' });
    expect(store.snapshot().composer.cursor).toBe(1);
    store.dispatch({ type: 'composer.insert', text: 'x' });
    expect(store.snapshot().composer).toEqual({ text: `Ax${emoji}B`, cursor: 2 });
    store.dispatch({ type: 'composer.move', direction: 'right' });
    expect(store.snapshot().composer.cursor).toBe(2 + emoji.length);
    store.dispatch({ type: 'composer.move', direction: 'start' });
    expect(store.snapshot().composer.cursor).toBe(0);
    store.dispatch({ type: 'composer.move', direction: 'end' });
    expect(store.snapshot().composer.cursor).toBe(`Ax${emoji}B`.length);
  });

  it('deletes one complete grapheme after the cursor', () => {
    const store = new WorkbenchStore();
    const emoji = `\u{1f469}\u200d\u{1f4bb}`;
    store.dispatch({ type: 'composer.insert', text: `A${emoji}B` });
    store.dispatch({ type: 'composer.move', direction: 'start' });
    store.dispatch({ type: 'composer.move', direction: 'right' });
    store.dispatch({ type: 'composer.delete' });
    expect(store.snapshot().composer).toEqual({ text: 'AB', cursor: 1 });
    store.dispatch({ type: 'composer.delete' });
    expect(store.snapshot().composer).toEqual({ text: 'A', cursor: 1 });
    const atEnd = store.snapshot();
    expect(store.dispatch({ type: 'composer.delete' })).toBe(atEnd);
  });

  it('queues messages FIFO and toggles one drawer at a time', () => {
    const store = new WorkbenchStore();
    store.dispatch({ type: 'queue.add', message: { id: 'q1', text: 'one', createdAt: 1 } });
    store.dispatch({ type: 'queue.add', message: { id: 'q2', text: 'two', createdAt: 2 } });
    store.dispatch({ type: 'drawer.toggle', drawer: 'agents' });
    expect(store.snapshot().focus).toBe('drawer');
    store.dispatch({ type: 'agent.select', agentId: 'agent-2', scrollOffset: 1 });
    store.dispatch({ type: 'drawer.toggle', drawer: 'tasks' });

    expect(store.snapshot().queuedMessages.map((message) => message.id)).toEqual(['q1', 'q2']);
    expect(store.snapshot().drawer).toBe('tasks');
    expect(store.snapshot()).toMatchObject({ selectedAgentId: 'agent-2', drawerScrollOffset: 0, focus: 'drawer' });
    store.dispatch({ type: 'queue.shift' });
    expect(store.snapshot().queuedMessages.map((message) => message.id)).toEqual(['q2']);
  });

  it('returns focus to the composer when the drawer closes', () => {
    const store = new WorkbenchStore();
    store.dispatch({ type: 'drawer.toggle', drawer: 'agents' });
    store.dispatch({ type: 'drawer.close' });
    expect(store.snapshot()).toMatchObject({ drawer: 'closed', focus: 'composer', drawerScrollOffset: 0 });
  });
});
