/**
 * Q-L2 — evolution-tab keybindings (pure). The evolution view has TWO
 * selection levels — a left capability cursor and a right stage cursor —
 * plus an artifact cursor inside an expanded stage and a read-only Q-L3
 * inspector. Arrow keys navigate whichever cursor owns the current focus
 * level (the view decides from `perTab.evolutionFocus`); this module only
 * maps a key to an action signal.
 *
 * `q` returns to the root spine (quit drill-down); the app-level global quit
 * (on non-input tabs) remains untouched — in the live TUI the global handler
 * claims `q` first, so this fallback only fires where that handler does not.
 *
 * Accepts both normalized lowercase labels (as produced by the TUI key
 * dispatcher for control keys, e.g. `enter`, `escape`) and canonical names
 * (`Enter`, `Escape`), plus Unicode arrows and the raw ESC byte `\x1b`.
 */
import type { ViewInputContext } from '../views/types.js';

export type EvolutionKeyAction =
  | { action: 'navigate'; direction: -1 | 1 }
  | { action: 'expand' }
  | { action: 'collapse' }
  | { action: 'flat' }
  | { action: 'spine' }
  | { action: 'select' }
  | { action: 'none' };

export function evolutionKeyAction(key: string, perTab: Readonly<ViewInputContext['perTab']>): EvolutionKeyAction {
  switch (key) {
    case 'ArrowUp': case 'k': case 'K': return { action: 'navigate', direction: -1 };
    case 'ArrowDown': case 'j': case 'J': return { action: 'navigate', direction: 1 };
    case 'Enter': case 'enter': case '\r': case '\n':
    case 'ArrowRight': case '→':
      // Enter while a stage is expanded selects the artifact under the cursor
      // (Q-L3 inspector); otherwise it expands the CURRENTLY SELECTED stage.
      return perTab.evolutionExpandedStage ? { action: 'select' } : { action: 'expand' };
    case 'ArrowLeft': case 'Escape': case 'escape': case '←': case '\x1b': return { action: 'collapse' };
    case 'f': case 'F': return { action: 'flat' };
    case 'c': case 'C': case 'q': case 'Q': return { action: 'spine' };
    default: return { action: 'none' };
  }
}
