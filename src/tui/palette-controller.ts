import { PaletteModal } from './capabilities/palette.js';
import { getCapabilityService } from './capabilities/capability-service.js';
import type { CapabilityService } from './capabilities/capability-service.js';
import type { CanvasRect } from './canvas.js';

export interface PaletteControllerOpts {
  capabilityService?: CapabilityService;
}

/** Command-palette modal — key routing while open + overlay paint. */
export class PaletteController {
  readonly modal = new PaletteModal();
  open = false;
  query = '';

  constructor(private readonly opts: PaletteControllerOpts) {}

  hasCapabilityService(): boolean {
    try { getCapabilityService(); return true; } catch { return false; }
  }

  /** Route a key while the palette is open. */
  handleKey(key: string): void {
    if (key === 'Escape') { this.open = false; return; }
    if (key === 'Ctrl+p') { this.open = false; return; }
    if (key === '\x03') { process.exit(0); return; }
    if (key === 'Enter') {
      if (!this.modal.empty) {
        const entry = this.modal.selected();
        this.open = false;
        entry.invoke();
      }
      return;
    }
    if (key === 'ArrowUp') { this.modal.move(-1); return; }
    if (key === 'ArrowDown') { this.modal.move(1); return; }
    if (key === 'Backspace') { this.query = this.query.slice(0, -1); }
    else if (key && key.length === 1) { this.query += key; }
    this.modal.refresh(this.query);
  }

  /** Render the palette as an overlay in the active view's canvas. No-op when closed. */
  paint(rect: CanvasRect): void {
    if (!this.open) return;
    const { canvas, width, height, headerH } = rect;
    const PALETTE_H = 12;
    const y = Math.max(headerH + 1, Math.floor(height / 2) - Math.floor(PALETTE_H / 2));
    const innerW = Math.max(0, width - 4);
    canvas.drawBox(1, y, innerW, PALETTE_H, ' Command Palette (Ctrl+P) ', '\x1b[90m');
    canvas.write(3, y + 1, `\x1b[7m ${this.query} \x1b[0m`);
    const list = this.modal.list;
    const rows = Math.max(0, PALETTE_H - 3);
    const start = Math.max(0, Math.min(this.modal.selectedIndex(), list.length - rows));
    for (let i = 0; i < Math.min(list.length, rows); i++) {
      const entry = list[start + i]!;
      const sel = start + i === this.modal.selectedIndex();
      const line = `${sel ? '› ' : '  '}${entry.title}${entry.subtitle ? `  \x1b[90m${entry.subtitle}\x1b[0m` : ''}`;
      canvas.write(3, y + 2 + i, (sel ? '\x1b[36m' : '') + line.slice(0, innerW - 4) + (sel ? '\x1b[0m' : ''));
    }
    if (list.length === 0) canvas.write(3, y + 2, '\x1b[90mNo capabilities found\x1b[0m');
  }
}
