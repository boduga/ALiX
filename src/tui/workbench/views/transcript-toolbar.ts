import type { TerminalCanvas } from '../../canvas.js';
import { displayWidth, truncateDisplayText } from '../../terminal-text.js';
import type { WorkbenchRegion } from '../layout/responsive-layout.js';
import type { WorkbenchUiState } from '../model/ui-state.js';
import { getWorkbenchPreviewTheme, type WorkbenchPreviewTheme } from '../model/preview-theme.js';

/** Bounded presentation controls; keyboard actions remain in the controller. */
export function paintTranscriptToolbar(
  canvas: TerminalCanvas,
  region: WorkbenchRegion,
  state?: WorkbenchUiState,
  newItems = 0,
  theme: WorkbenchPreviewTheme = getWorkbenchPreviewTheme(),
): void {
  if (region.height <= 0 || region.width <= 0) return;
  const { palette: p } = theme;
  const reset = '\x1b[0m';
  const width = Math.max(0, region.width - 2);
  const put = (row: number, text: string, color = p.muted) => {
    const bounded = truncateDisplayText(theme.glyphMode === 'ascii' ? text.replace(/–/g, '-').replace(/·/g, '.') : text, width);
    if (row < region.height) canvas.write(region.x + Math.min(1, region.width - 1), region.y + row, `${color}${bounded}${' '.repeat(Math.max(0, width - displayWidth(bounded)))}${reset}`);
  };
  const follow = `Auto-follow: ${state?.followTail === false ? 'OFF' : 'ON'}${newItems > 0 ? ` +${newItems} new` : ''}`;
  const title = 'LIVE TRANSCRIPT';
  put(0, title, p.cyan);
  if (displayWidth(title) + displayWidth(follow) + 2 <= width) {
    canvas.write(region.x + 1 + width - displayWidth(follow), region.y, `${p.muted}Auto-follow: ${state?.followTail === false ? p.yellow : p.green}${state?.followTail === false ? 'OFF' : 'ON'}${newItems > 0 ? `${p.yellow} +${newItems} new` : ''}${reset}`);
  } else {
    put(0, `Follow: ${state?.followTail === false ? 'OFF' : 'ON'}${newItems > 0 ? ` +${newItems} new` : ''}`, state?.followTail === false ? p.yellow : p.green);
  }
  if (region.height >= 2) {
    const filters = ['all', 'response', 'tool', 'activity', 'error'] as const;
    const selected = state?.transcriptFilter ?? 'all';
    const full = filters.map((filter, index) => ({ filter, label: `${index + 1} ${filter.toUpperCase()}` }));
    const compact = filters.map((filter, index) => ({ filter, label: `${index + 1}${filter.slice(0, 1).toUpperCase()}` }));
    const labels = full.reduce((sum, entry) => sum + entry.label.length + 3, -1) <= width ? full : compact;
    let x = 0;
    for (const { filter, label } of labels) {
      const chip = filter === selected ? `[${label}]` : `(${label})`;
      if (x + chip.length > width) break;
      canvas.write(region.x + 1 + x, region.y + 1, `${filter === selected ? `${p.badgeFill}${p.badgeText}\x1b[1m` : p.muted}${chip}${reset}`);
      x += chip.length + 1;
    }
    if (labels.reduce((sum, entry) => sum + entry.label.length + 3, -1) > width) put(1, `[${selected.toUpperCase()}]`, p.cyan);
  }
  const scope = state?.transcriptScope === 'selected' && state.selectedAgentId ? `Selected: ${state.selectedAgentId}` : 'All agents';
  put(2, `${scope} ${theme.glyphs.separator} ${state?.transcriptMode === 'detailed' ? 'details' : 'compact'} ${theme.glyphs.separator} ${state?.focus === 'transcript' ? '1–5 filters · s scope · f follow · Esc composer' : 'Ctrl+F transcript'}`);
}
