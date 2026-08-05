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

  computeStrip(): SlashStrip | null {
    const buf = this.buffer();
    if (!buf) { this.selection = 0; this.hint = null; return null; }
    const parsed = parseSlashInput(buf);
    if (!parsed) { this.hint = null; return null; }
    const matches = rankSkillMatches(this.manifests, parsed.command);
    this.selection = Math.min(this.selection, Math.max(0, matches.length - 1));
    if (matches.length > 0) {
      if (parsed.command !== '/') this.hint = null;
    } else if (this.manifests.length === 0) {
      this.hint = 'no skills installed';
    } else {
      this.hint = `no skill matches ${parsed.command}`;
    }
    return {
      entries: matches.slice(0, 8).map((m): SlashStripEntry => ({
        name: m.name,
        label: skillSlashNames(m)[0] ?? `/${m.name}`,
        description: m.description,
      })),
      selected: this.selection,
      hint: this.hint,
    };
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
