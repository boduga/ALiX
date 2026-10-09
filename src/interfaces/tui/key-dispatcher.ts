/**
 * Key-dispatcher extracted from TuiApp's handleRaw method.
 *
 * Provides a publish/subscribe API for keybindings so the dispatch
 * logic is testable without instantiating the full TUI.
 *
 * Each handler returns `true` if it consumed the key (caller should
 * stop processing) or `false` if the key should fall through to the
 * next handler / default input-capture path.
 */
export class KeyDispatcher {
  private readonly handlers = new Map<string, Array<() => boolean>>();

  /**
   * Register a handler for a key string (e.g. `'Enter'`, `'Ctrl+l'`).
   * Multiple handlers can be registered for the same key; they are
   * tried in registration order and the first that returns `true` wins.
   */
  on(key: string, handler: () => boolean): void {
    const existing = this.handlers.get(key);
    if (existing) {
      existing.push(handler);
    } else {
      this.handlers.set(key, [handler]);
    }
  }

  /**
   * Dispatch a key string to all registered handlers.  Returns `true`
   * if any handler consumed the key, `false` otherwise.
   */
  dispatch(key: string): boolean {
    const handlers = this.handlers.get(key);
    if (!handlers) return false;
    for (const h of handlers) {
      if (h()) return true;
    }
    return false;
  }
}
