import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { pasteText, translateKeyEvent, type OpenTuiKey } from '../../../src/interfaces/tui/workbench/opentui/input.js';

function key(overrides: Partial<OpenTuiKey> & { name: string }): OpenTuiKey {
  return { ctrl: false, meta: false, shift: false, option: false, sequence: '', ...overrides };
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

  it('routes a multi-byte grapheme from the sequence', () => {
    assert.equal(translateKeyEvent(key({ name: '漢', sequence: '漢' })), '漢');
  });

  it('drops modifier combos the OS owns and key releases', () => {
    assert.equal(translateKeyEvent(key({ name: 'a', meta: true, sequence: 'a' })), null);
    assert.equal(translateKeyEvent(key({ name: 'a', option: true, sequence: 'a' })), null);
    assert.equal(translateKeyEvent(key({ name: 'a', sequence: 'a', eventType: 'release' })), null);
  });

  it('normalizes paste line endings and strips ANSI', () => {
    assert.equal(pasteText({ bytes: new TextEncoder().encode('a\r\nb\rc') }), 'a\nb\nc');
    assert.equal(pasteText({ bytes: new TextEncoder().encode('x\x1b[31mred\x1b[0m') }), 'xred');
  });
});
