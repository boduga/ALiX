/**
 * Q-L2 — evolution-tab keybindings (pure). `q` returns to the root spine
 * (quit drill-down); the app-level global quit remains untouched.
 *
 * Accepts both normalized lowercase labels (as produced by the TUI key
 * dispatcher, e.g. `enter`, `escape`) and canonical key names (`Enter`,
 * `Escape`), plus Unicode arrows (`→`, `←`) — all map to the same actions.
 */
import type { ViewInputContext } from '../views/types.js';

export type EvolutionKeyAction =
  | { action: 'navigate'; direction: -1 | 1 }
  | { action: 'expand' }
  | { action: 'collapse' }
  | { action: 'scroll'; offset: -1 | 1 }
  | { action: 'flat' }
  | { action: 'spine' }
  | { action: 'select' }
  | { action: 'inspect'; type: string; id: string }
  | { action: 'none' };

export function evolutionKeyAction(key: string, _perTab: Readonly<ViewInputContext['perTab']>): EvolutionKeyAction {
  switch (key) {
    case 'ArrowUp': case 'k': case 'K': return { action: 'navigate', direction: -1 };
    case 'ArrowDown': case 'j': case 'J': return { action: 'navigate', direction: 1 };
    case 'Enter': case 'enter': case 'ArrowRight': case '→': return { action: 'expand' };
    case 'ArrowLeft': case 'Escape': case 'escape': case '←': return { action: 'collapse' };
    case 'f': case 'F': return { action: 'flat' };
    case 'c': case 'C': return { action: 'spine' };
    case 'q': case 'Q': return { action: 'spine' }; // quit drill-down → root spine
    default: return { action: 'none' };
  }
}
