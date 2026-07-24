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
  approvalHint: Widgets.BoxElement,
  emit: (event: RendererEvent) => void,
): void {
  // ── Exit ──
  screen.key(['C-c'], () => emit({ type: 'exit' }));

  // ── Tab cycling ──
  screen.key(['Tab'], () => emit({ type: 'cycleTab', forward: true }));
  screen.key(['S-Tab'], () => emit({ type: 'cycleTab', forward: false }));

  // ── Input focus control ──
  screen.key(['escape'], () => emit({ type: 'homeTab' }));

  // ── Direct tab switching (1-7) ──
  for (const [key, tab] of Object.entries(TAB_KEYS)) {
    screen.key([key], () => emit({ type: 'switchTab', tab }));
  }

  // ── Input mirroring and submission ──
  textarea.on('keypress', (_ch, key) => {
    const keyName = (key as { name?: string } | undefined)?.name;
    if (keyName === 'enter' || keyName === 'return') return;
    setImmediate(() => {
      emit({ type: 'inputChanged', value: textarea.getValue() });
    });
  });
  textarea.on('submit', () => {
    const value = textarea.getValue();
    emit({ type: 'submitInput', value });
    textarea.clearValue();
    emit({ type: 'inputChanged', value: textarea.getValue() });
  });
  textarea.key(['enter'], () => {
    const value = textarea.getValue();
    if (value.endsWith('\n')) textarea.setValue(value.slice(0, -1));
    (textarea as Widgets.TextareaElement & { emit(event: string): boolean }).emit('submit');
  });

  // Approval shortcuts only take over printable input while the hint is shown.
  const textareaKey = (textarea as Widgets.TextareaElement & {
    key?: (keys: string | string[], listener: () => void) => void;
  }).key;
  textareaKey?.call(textarea, ['a'], () => {
    if (!(approvalHint as Widgets.BoxElement & { hidden?: boolean }).hidden) {
      emit({ type: 'resolveApproval', status: 'approved' });
    }
  });
  textareaKey?.call(textarea, ['d'], () => {
    if (!(approvalHint as Widgets.BoxElement & { hidden?: boolean }).hidden) {
      emit({ type: 'resolveApproval', status: 'denied' });
    }
  });
}

