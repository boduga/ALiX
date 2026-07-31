// src/tui/capabilities/capabilities-view.ts
import type { PerTabState, TabId } from '../state.js';
import type { ViewAction, ViewInputContext, ViewRenderContext, ViewRenderResult, TuiView } from '../views/types.js';
import type { TerminalCanvas } from '../canvas.js';
import { truncate } from '../box.js';
import { getCapabilityService } from './capability-service.js';
import type { Capability } from '../../capability/types.js';

/** Search state is carried in PerTabState.searchQuery (already present). */

/** Search is subsequence fuzzy, mirroring the palette. */
function subsequence(q: string, s: string): boolean {
  let i = 0;
  const hay = s.toLowerCase();
  for (let j = 0; j < hay.length && i < q.length; j++) if (hay[j] === q[i]) i++;
  return i === q.length;
}

/** Filter the full catalog by the current query (subsequence fuzzy on title/id). */
function filtered(caps: Capability[], query: string): Capability[] {
  const q = query.toLowerCase();
  if (!q) return caps;
  return caps.filter((cap) => subsequence(q, cap.title) || subsequence(q, cap.id));
}

export class CapabilitiesView implements TuiView {
  readonly id: TabId = 'capabilities';

  render(ctx: ViewRenderContext): ViewRenderResult {
    const c = ctx.canvas!;
    const service = getCapabilityService();
    const query = (ctx.perTab.searchQuery ?? '').toLowerCase();
    const all = service.query();
    const caps = filtered(all, query);

    // Lazy-init the selection on first paint so the detail pane shows
    // immediately. ctx.perTab is typed Readonly in render; the single
    // selection write casts to the mutable PerTabState (all other writes
    // happen in handleKey, which owns a mutable ctx.perTab).
    if (ctx.perTab.capabilitiesSelectedId === undefined && caps.length > 0) {
      (ctx.perTab as PerTabState).capabilitiesSelectedId = caps[0]!.id;
    }
    const selectedId = ctx.perTab.capabilitiesSelectedId;

    // Left: list.
    c.write(0, 4, `\x1b[1mCapabilities\x1b[0m  \x1b[90m${caps.length} of ${all.length}\x1b[0m`);
    c.write(0, 5, `\x1b[33msearch>\x1b[0m ${query}`);
    const listTop = 6;
    const listW = Math.floor(ctx.dimensions.columns / 2) - 1;
    for (let i = 0; i < Math.min(caps.length, ctx.dimensions.rows - listTop - 3); i++) {
      const cap = caps[i]!;
      const status = service.getStatus(cap.id);
      const dot = status?.availability === 'available' || !status ? '\x1b[32m●\x1b[0m'
        : status?.availability === 'degraded' ? '\x1b[33m●\x1b[0m' : '\x1b[31m●\x1b[0m';
      const sel = cap.id === selectedId;
      const line = `${sel ? '\x1b[36m' : ''}${dot} ${cap.title}  \x1b[90m${cap.id}\x1b[0m${sel ? '\x1b[0m' : ''}`;
      c.write(0, listTop + i, truncate(line, listW));
    }

    // Right: detail of the selected capability.
    const detail = caps.find((cap) => cap.id === selectedId) ?? caps[0];
    if (detail) this.renderDetail(c, detail, listW + 1, 4, ctx.dimensions.columns - listW - 2, ctx.dimensions.rows - 7);

    return { rows: [] };
  }

  private renderDetail(c: TerminalCanvas, detail: Capability, x: number, y: number, w: number, h: number): void {
    c.write(x, y, `\x1b[1m${detail.title}\x1b[0m  \x1b[90m${detail.id} v${detail.version}\x1b[0m`);
    const lines: string[] = [];
    lines.push(detail.description);
    lines.push(`category: ${detail.category}   risk: ${detail.risk}`);
    lines.push(`kind: ${detail.kind}   tags: ${(detail.tags ?? []).join(', ')}`);
    lines.push(`permissions: ${(detail.requiredPermissions ?? []).join(', ')}`);
    const ex = detail.execution;
    lines.push(`strategy: ${ex.strategy}   timeout: ${ex.timeout ?? '—'}   cancellable: ${ex.cancellable ?? false}`);
    if (detail.argsSchema) lines.push(`args: ${JSON.stringify(detail.argsSchema)}`);
    if (detail.examples?.length) lines.push(`examples: ${detail.examples.join(' · ')}`);
    if (detail.dependencies?.length) lines.push(`depends on: ${detail.dependencies.join(', ')}`);
    for (let i = 0; i < Math.min(lines.length, h); i++) {
      const text = lines[i]!.slice(0, w);
      c.write(x, y + 1 + i, `\x1b[90m${text}\x1b[0m`);
    }
  }

  handleKey(key: string, ctx: ViewInputContext): ViewAction {
    // handleKey is permitted to mutate ctx.perTab (ViewInputContext is
    // "mutable from within handleKey only") — render stays pure.
    const service = getCapabilityService();
    const caps = filtered(service.query(), ctx.perTab.searchQuery ?? '');
    const idx = caps.findIndex((cap) => cap.id === ctx.perTab.capabilitiesSelectedId);
    switch (key) {
      case 'ArrowDown':
      case 'j': {
        const next = caps[(idx + 1) % caps.length];
        if (next) ctx.perTab.capabilitiesSelectedId = next.id;
        return { type: 'handled' };
      }
      case 'ArrowUp':
      case 'k': {
        const next = caps[(idx - 1 + caps.length) % caps.length];
        if (next) ctx.perTab.capabilitiesSelectedId = next.id;
        return { type: 'handled' };
      }
      case 'Enter': {
        const cap = caps[idx];
        if (cap) service.invoke(cap.id, {});
        return { type: 'handled' };
      }
      case 'Backspace': {
        ctx.perTab.searchQuery = (ctx.perTab.searchQuery ?? '').slice(0, -1);
        return { type: 'handled' };
      }
      default: {
        if (key && key.length === 1) {
          ctx.perTab.searchQuery = (ctx.perTab.searchQuery ?? '') + key;
          return { type: 'handled' };
        }
        return { type: 'handled' };
      }
    }
  }
}
