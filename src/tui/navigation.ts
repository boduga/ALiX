import type { TabId } from './state.js';

export type NavigationKey =
  | { type: 'cycle'; forward: boolean }
  | { type: 'jump'; tab: TabId }
  | { type: 'home' };

export class Navigation {
  private cursor = 0;
  private readonly order: readonly TabId[] = ['chat', 'daemon', 'approvals', 'runtime', 'sops', 'policy'];
  private readonly shortcuts: Readonly<Record<string, TabId>> = {
    c: 'chat',
    d: 'daemon',
    a: 'approvals',
    r: 'runtime',
    s: 'sops',
    p: 'policy',
  };

  interpret(rawKey: string): NavigationKey | null {
    if (rawKey === 'Tab') return { type: 'cycle', forward: true };
    if (rawKey === 'Shift+Tab') return { type: 'cycle', forward: false };
    if (rawKey === 'Escape') return { type: 'home' };
    if (/^[1-6]$/.test(rawKey)) {
      const idx = Number(rawKey) - 1;
      if (idx >= 0 && idx < this.order.length) return { type: 'jump', tab: this.order[idx]! };
    }
    const lower = rawKey.toLowerCase();
    const jump = this.shortcuts[lower];
    if (jump) return { type: 'jump', tab: jump };
    return null;
  }

  /** Reserved for future use; TuiApp applies navigation externally. */
  nextTab(): TabId | null { return null; }
}
