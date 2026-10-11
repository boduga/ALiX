import type { KeyEvent, PasteEvent } from '@opentui/core';

export type OpenTuiKey = Pick<KeyEvent, 'name' | 'ctrl' | 'meta' | 'shift' | 'option' | 'sequence'> & {
  readonly eventType?: string;
};

const NAMED_KEYS: Readonly<Record<string, string>> = {
  escape: 'Escape',
  backspace: 'Backspace',
  delete: 'Delete',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  up: 'ArrowUp',
  down: 'ArrowDown',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  space: ' ',
};

export function translateKeyEvent(event: OpenTuiKey): string | null {
  if (event.eventType === 'release') return null;
  if (event.meta || event.option) return null;
  if (event.ctrl && event.name.length === 1) return `Ctrl+${event.name.toLowerCase()}`;
  if (event.name === 'tab') return event.shift ? 'Shift+Tab' : 'Tab';
  if (event.name === 'return' || event.name === 'enter') return event.shift ? 'Shift+Enter' : 'Enter';
  const named = NAMED_KEYS[event.name];
  if (named) return named;
  if (event.sequence && !event.ctrl && !/[\u0000-\u001f\u007f]/.test(event.sequence)) return event.sequence;
  return null;
}

export function pasteText(event: Pick<PasteEvent, 'bytes'>): string {
  return new TextDecoder().decode(event.bytes).replace(ANSI_SEQUENCES, '').replace(/\r\n?/g, '\n');
}

const ANSI_SEQUENCES = /\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]/g;
