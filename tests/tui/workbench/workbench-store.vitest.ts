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

  it('queues messages FIFO and toggles one drawer at a time', () => {
    const store = new WorkbenchStore();
    store.dispatch({ type: 'queue.add', message: { id: 'q1', text: 'one', createdAt: 1 } });
    store.dispatch({ type: 'queue.add', message: { id: 'q2', text: 'two', createdAt: 2 } });
    store.dispatch({ type: 'drawer.toggle', drawer: 'agents' });
    store.dispatch({ type: 'drawer.toggle', drawer: 'tasks' });

    expect(store.snapshot().queuedMessages.map((message) => message.id)).toEqual(['q1', 'q2']);
    expect(store.snapshot().drawer).toBe('tasks');
    store.dispatch({ type: 'queue.shift' });
    expect(store.snapshot().queuedMessages.map((message) => message.id)).toEqual(['q2']);
  });
});
