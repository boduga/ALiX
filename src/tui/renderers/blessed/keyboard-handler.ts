import type { Widgets } from 'neo-blessed';
import type { RendererEvent } from '../../../tui/renderer/types.js';
import type { TabId } from '../../../tui/state.js';

const TAB_KEYS: Record<string, TabId> = {
  '1': 'chat',
  '2': 'agent',
  '3': 'daemon',
  '4': 'approvals',
  '5': 'runtime',
  '6': 'sops',
  '7': 'policy',
};

/**
 * Register all keyboard handlers on a blessed screen.
 * Emits RendererEvent through the provided callback.
 * Must be called once during renderer initialization.
 */
export function setupKeyboardHandler(
  screen: Widgets.Screen,
  textarea: Widgets.TextareaElement,
  emit: (event: RendererEvent) => void,
): void {
  // ── Exit ──
  screen.key(['C-c', 'q', 'Q'], () => emit({ type: 'exit' }));

  // ── Tab cycling ──
  screen.key(['Tab'], () => emit({ type: 'cycleTab', forward: true }));
  screen.key(['S-Tab'], () => emit({ type: 'cycleTab', forward: false }));

  // ── Input focus control ──
  screen.key(['escape'], () => emit({ type: 'blurInput' }));
  screen.key(['i'], () => emit({ type: 'focusInput' }));

  // ── Direct tab switching (1-7) ──
  for (const [key, tab] of Object.entries(TAB_KEYS)) {
    screen.key([key], () => emit({ type: 'switchTab', tab }));
  }

  // ── Input submission ──
  // Emit the submitInput event BEFORE clearing the value so the app
  // can reject the submission if needed.
  textarea.on('submit', () => {
    const value = textarea.getValue();
    emit({ type: 'submitInput', value });
    textarea.clearValue();
  });
}
