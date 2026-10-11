import assert from 'node:assert/strict';
import { describe, expect, it } from 'vitest';
import { pasteIntent, pasteText, routeOpenTuiKey, translateKeyEvent, type OpenTuiKey } from '../../../src/interfaces/tui/workbench/opentui/input.js';
import type { WorkbenchInputContext } from '../../../src/interfaces/tui/workbench/input/input-router.js';

function key(overrides: Partial<OpenTuiKey> & { name: string }): OpenTuiKey {
  return { ctrl: false, meta: false, shift: false, option: false, sequence: '', ...overrides };
}

function context(overrides: Partial<WorkbenchInputContext> = {}): WorkbenchInputContext {
  return {
    turnActive: false, composerText: '', slashActive: false,
    transcriptMode: 'compact', drawer: 'closed', focus: 'composer',
    ...overrides,
  };
}

describe('OpenTUI key translation', () => {
  it('maps printable keys, including shifted case, from the sequence', () => {
    assert.equal(translateKeyEvent(key({ name: 'a', sequence: 'a' })), 'a');
    assert.equal(translateKeyEvent(key({ name: 'A', shift: true, sequence: 'A' })), 'A');
    assert.equal(translateKeyEvent(key({ name: '1', sequence: '1' })), '1');
    assert.equal(translateKeyEvent(key({ name: '[', sequence: '[' })), '[');
    assert.equal(translateKeyEvent(key({ name: 'space', sequence: ' ' })), ' ');
  });

  it('maps control chords to the Ctrl+<letter> vocabulary', () => {
    assert.equal(translateKeyEvent(key({ name: 'e', ctrl: true, sequence: '\u0005' })), 'Ctrl+e');
    assert.equal(translateKeyEvent(key({ name: 'R', ctrl: true, sequence: '\u0012' })), 'Ctrl+r');
  });

  it('maps named control and navigation keys', () => {
    assert.equal(translateKeyEvent(key({ name: 'escape' })), 'Escape');
    assert.equal(translateKeyEvent(key({ name: 'backspace', sequence: '\u007f' })), 'Backspace');
    assert.equal(translateKeyEvent(key({ name: 'delete', sequence: '\u001b[3~' })), 'Delete');
    assert.equal(translateKeyEvent(key({ name: 'up', sequence: '\u001b[A' })), 'ArrowUp');
    assert.equal(translateKeyEvent(key({ name: 'pageup', sequence: '\u001b[5~' })), 'PageUp');
    assert.equal(translateKeyEvent(key({ name: 'end' })), 'End');
  });

  it('distinguishes Tab and Enter shift variants', () => {
    assert.equal(translateKeyEvent(key({ name: 'tab' })), 'Tab');
    assert.equal(translateKeyEvent(key({ name: 'tab', shift: true })), 'Shift+Tab');
    assert.equal(translateKeyEvent(key({ name: 'return', sequence: '\r' })), 'Enter');
    assert.equal(translateKeyEvent(key({ name: 'return', shift: true, sequence: '\r' })), 'Shift+Enter');
  });

  it('drops modifier combos the OS owns and key releases', () => {
    assert.equal(translateKeyEvent(key({ name: 'a', meta: true, sequence: 'a' })), null);
    assert.equal(translateKeyEvent(key({ name: 'a', option: true, sequence: 'a' })), null);
    assert.equal(translateKeyEvent(key({ name: 'a', sequence: 'a', eventType: 'release' })), null);
  });

  it('routes through the shared Workbench router', () => {
    expect(routeOpenTuiKey(key({ name: 'e', ctrl: true }), context())).toEqual({ type: 'inspector.open' });
    expect(routeOpenTuiKey(key({ name: 'x', sequence: 'x' }), context())).toEqual({ type: 'composer.insert', text: 'x' });
    expect(routeOpenTuiKey(key({ name: 'a', sequence: 'a' }), context({ approvalPending: true })))
      .toEqual({ type: 'approval.resolve', decision: 'approved' });
    expect(routeOpenTuiKey(key({ name: 'a', meta: true, sequence: 'a' }), context())).toEqual({ type: 'unhandled' });
  });

  it('routes focus, overlay priority, cancellation, queue, and slash keys', () => {
    expect(routeOpenTuiKey(key({ name: 'f', ctrl: true }), context())).toEqual({ type: 'focus.set', focus: 'transcript' });
    expect(routeOpenTuiKey(key({ name: 'escape' }), context({ overlayOpen: true }))).toEqual({ type: 'overlay.close' });
    expect(routeOpenTuiKey(key({ name: 'escape' }), context({ turnActive: true, focus: 'transcript' }))).toEqual({ type: 'turn.cancel' });
    expect(routeOpenTuiKey(key({ name: 'return' }), context({ turnActive: true, composerText: 'next' }))).toEqual({ type: 'turn.queue' });
    expect(routeOpenTuiKey(key({ name: 'return' }), context({ slashActive: true }))).toEqual({ type: 'slash.submit' });
  });

  it('routes a multi-byte grapheme from the sequence', () => {
    assert.equal(translateKeyEvent(key({ name: '漢', sequence: '漢' })), '漢');
    expect(routeOpenTuiKey(key({ name: '漢', sequence: '漢' }), context())).toEqual({ type: 'composer.insert', text: '漢' });
  });

  it('normalizes paste line endings and yields a composer intent', () => {
    const bytes = new TextEncoder().encode('a\r\nb\rc');
    assert.equal(pasteText({ bytes }), 'a\nb\nc');
    expect(pasteIntent({ bytes })).toEqual({ type: 'composer.insert', text: 'a\nb\nc' });
  });

  it('decodes bracketed paste payloads', () => {
    assert.equal(pasteText({ bytes: new TextEncoder().encode('line one\nline two') }), 'line one\nline two');
  });
});
