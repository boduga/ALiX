import type { TabId } from './state.js';

export type NavigationKey =
  | { type: 'cycle'; forward: boolean }
  | { type: 'jump'; tab: TabId }
  | { type: 'home' };

export class Navigation {
  private cursor = 0;
  private readonly order: readonly TabId[] = ['chat', 'agent', 'daemon', 'approvals', 'runtime', 'sops', 'policy'];

  interpret(rawKey: string): NavigationKey | null {
    if (rawKey === 'Tab') return { type: 'cycle', forward: true };
    if (rawKey === 'Shift+Tab') return { type: 'cycle', forward: false };
    if (rawKey === 'Escape') return { type: 'home' };
    // Ctrl+digit (encoded by terminals as ESC + digit). Matches up to
    // 9 tab positions; bounds check below enforces the actual order
    // length. Single-letter shortcuts removed — Ctrl+digit is the
    // single shortcut surface.
    const ctrlDigit = /^Ctrl\+([0-9])$/.exec(rawKey);
    if (ctrlDigit) {
      const idx = Number(ctrlDigit[1]) - 1;
      if (idx >= 0 && idx < this.order.length) return { type: 'jump', tab: this.order[idx]! };
    }
    return null;
  }

  /** Reserved for future use; TuiApp applies navigation externally. */
  nextTab(): TabId | null { return null; }
}
