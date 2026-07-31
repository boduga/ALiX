// src/tui/capabilities/palette.ts
import { getCapabilityService } from './capability-service.js';
import type { Capability } from '../../capability/types.js';

/** A UI action in the palette — NOT a capability. View concerns only. */
export interface PaletteAction {
  id: string;
  title: string;
  run(): void;
}

export interface PaletteEntry {
  id: string;
  title: string;
  subtitle?: string;
  invoke(): void;
}

/** Supplies entries to the palette. Capabilities and UI actions are distinct. */
export interface PaletteProvider {
  readonly id: string;
  readonly title: string;
  search(query: string): PaletteEntry[];
}

/** Subsequence fuzzy match — 'cslist' matches 'core.session.list'. No deps. */
function subsequenceMatches(q: string, s: string): boolean {
  const needle = q.toLowerCase();
  const hay = s.toLowerCase();
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) {
    if (hay[j] === needle[i]) i++;
  }
  return i === needle.length;
}

function matches(cap: Capability, query: string): boolean {
  if (!query) return true;
  return subsequenceMatches(query, cap.title) || subsequenceMatches(query, cap.id);
}

/** Phase-2 enabled provider: capabilities flow Registry → Runtime → Invocation. */
export class CapabilityProvider implements PaletteProvider {
  readonly id = 'capabilities';
  readonly title = 'Capabilities';

  search(query: string): PaletteEntry[] {
    const service = getCapabilityService();
    return service.query().filter((cap) => matches(cap, query)).map((cap) => ({
      id: cap.id,
      title: cap.title,
      subtitle: cap.id,
      invoke: () => { service.invoke(cap.id, {}); },
    }));
  }
}

/** Stubbed empty — UI actions are registered here in a later phase. */
export class ActionProvider implements PaletteProvider {
  readonly id = 'actions';
  readonly title = 'Actions';
  search(): PaletteEntry[] { return []; }
}

/** Pure modal state: entries + cursor. Rendered by TuiApp. */
export class PaletteModal {
  private entries: PaletteEntry[] = [];
  private cursor = 0;
  private providers: PaletteProvider[];

  constructor(providers: PaletteProvider[] = [new CapabilityProvider(), new ActionProvider()]) {
    this.providers = providers;
  }

  /** Directly set the entry list (test seam; production uses refresh()). */
  setEntries(entries: PaletteEntry[]): void {
    this.entries = entries;
    this.cursor = 0;
  }

  refresh(query: string): void {
    const entries = this.providers.flatMap((p) => p.search(query));
    this.entries = entries;
    this.cursor = Math.min(this.cursor, Math.max(0, entries.length - 1));
  }

  get list(): PaletteEntry[] { return this.entries; }
  get empty(): boolean { return this.entries.length === 0; }
  selected(): PaletteEntry { return this.entries[this.cursor]!; }
  selectedIndex(): number { return this.cursor; }
  move(delta: number): void {
    if (this.entries.length === 0) return;
    this.cursor = (this.cursor + delta + this.entries.length) % this.entries.length;
  }
}
