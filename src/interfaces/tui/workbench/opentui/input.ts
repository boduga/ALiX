import type { KeyEvent, PasteEvent } from '@opentui/core';
import { routeWorkbenchInput, type WorkbenchInputContext, type WorkbenchInputIntent } from '../input/input-router.js';

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
  return new TextDecoder().decode(event.bytes).replace(/\r\n?/g, '\n');
}

export function pasteIntent(event: Pick<PasteEvent, 'bytes'>): WorkbenchInputIntent {
  return { type: 'composer.insert', text: pasteText(event) };
}

export function routeOpenTuiKey(event: OpenTuiKey, context: WorkbenchInputContext): WorkbenchInputIntent {
  const key = translateKeyEvent(event);
  return key === null ? { type: 'unhandled' } : routeWorkbenchInput(key, context);
}
