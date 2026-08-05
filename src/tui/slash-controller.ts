import { parseSlashInput, rankSkillMatches, skillSlashNames } from '../skills/slash.js';
import { getSlashCatalog } from '../skills/slash-catalog.js';
import type { SlashStrip, SlashStripEntry } from './views/types.js';
import type { TabId } from './state.js';

/** Narrow accessors into the agent tab's per-tab state — the controller never
 *  sees the full TuiApp. */
export interface SlashTabAccess {
  activeTab(): TabId;
  getAgentBuffer(): string;
  setAgentBuffer(s: string): void;
  /** True once the owning TUI has been torn down (stop()/cleanupSync). */
  isDetached(): boolean;
}

/** Result of the pure strip computation — the strip plus the controller
 *  state it implies (clamped selection + hint), so the caller can apply
 *  them explicitly instead of a method that mutates while computing. */
export interface SlashStripState {
  strip: SlashStrip | null;
  selection: number;
  hint: string | null;
}

/** Pure computation of the completion strip and the selection/hint state it
 *  implies. `buffer` is the already-validated agent input, or null when the
 *  slash completion isn't active (see SlashController.buffer()). Exported so
 *  the strip math is testable without a controller. */
export function computeSlashStripState(
  manifests: any[],
  buffer: string | null,
  selection: number,
  hint: string | null,
): SlashStripState {
  if (!buffer) return { strip: null, selection: 0, hint: null };
  const parsed = parseSlashInput(buffer);
  if (!parsed) return { strip: null, selection, hint: null };
  const matches = rankSkillMatches(manifests, parsed.command);
  const clamped = Math.min(selection, Math.max(0, matches.length - 1));
  let nextHint = hint;
  if (matches.length > 0) {
    if (parsed.command !== '/') nextHint = null;
  } else if (manifests.length === 0) {
    nextHint = 'no skills installed';
  } else {
    nextHint = `no skill matches ${parsed.command}`;
  }
  return {
    strip: {
      entries: matches.slice(0, 8).map((m): SlashStripEntry => ({
        name: m.name,
        label: skillSlashNames(m)[0] ?? `/${m.name}`,
        description: m.description,
      })),
      selected: clamped,
      hint: nextHint,
    },
    selection: clamped,
    hint: nextHint,
  };
}

/** Slash-command completion strip state + logic (agent tab only). */
export class SlashController {
  manifests: any[] = [];
  selection = 0;
  hint: string | null = null;

  constructor(private readonly tabs: SlashTabAccess) {}

  active(): boolean {
    if (this.tabs.activeTab() !== 'agent') return false;
    const buf = this.tabs.getAgentBuffer();
    return buf.startsWith('/') && buf.length >= 1;
  }

  buffer(): string | null {
    if (this.tabs.activeTab() !== 'agent') return null;
    const buf = this.tabs.getAgentBuffer();
    return buf.startsWith('/') && buf.length >= 1 ? buf : null;
  }

  cycleSelection(delta: number): void {
    const strip = this.computeStrip();
    if (!strip || strip.entries.length === 0) return;
    const n = strip.entries.length;
    this.selection = (this.selection + delta + n) % n;
  }

  complete(): boolean {
    const buf = this.buffer();
    if (!buf) return false;
    const parsed = parseSlashInput(buf);
    if (!parsed) return false;
    const matches = rankSkillMatches(this.manifests, parsed.command);
    if (matches.length === 0) return false;
    const idx = Math.min(this.selection, matches.length - 1);
    const selected = matches[idx]!;
    const primary = skillSlashNames(selected)[0] ?? `/${selected.name}`;
    const rest = parsed.rest ? ` ${parsed.rest}` : ' ';
    this.tabs.setAgentBuffer(`${primary}${rest}`);
    this.selection = 0;
    return true;
  }

  /** Compute the strip and apply the selection/hint state it implies.
   *  The pure math lives in computeSlashStripState (exported for tests);
   *  this method applies the derived state to the controller. */
  computeStrip(): SlashStrip | null {
    const { strip, selection, hint } = computeSlashStripState(this.manifests, this.buffer(), this.selection, this.hint);
    this.selection = selection;
    this.hint = hint;
    return strip;
  }

  async refreshCatalog(): Promise<void> {
    const manifests = await getSlashCatalog();
    // Detached guard: the catalog read may resolve AFTER the owning TUI was
    // torn down (a snapshot-tick refresh in flight when stop()/cleanupSync
    // runs). Reassigning manifests on a detached instance is harmless but
    // pollutes the heap and races with stop(). The app routes every catalog
    // refresh through this method, so the guard lives here — do not move it
    // back into the caller or a future cleanup could "simplify" it away.
    if (this.tabs.isDetached()) return;
    this.manifests = manifests;
  }
}
