import type { RenderSurface } from '../renderer/surface.js';
import { TerminalCanvas } from '../canvas.js';

export class CanvasSurface implements RenderSurface {
  readonly width: number;
  readonly height: number;
  private canvas: TerminalCanvas;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.canvas = new TerminalCanvas(width, height);
  }

  write(x: number, y: number, text: string): void { this.canvas.write(x, y, text); }
  drawBox(x: number, y: number, w: number, h: number, title?: string, colorCode?: string): void { this.canvas.drawBox(x, y, w, h, title, colorCode); }
  drawBar(x: number, y: number, barWidth: number, fraction: number, color?: string): void { this.canvas.drawBar(x, y, barWidth, fraction, color); }
  clear(): void { this.canvas.clear(); }

  blit(source: RenderSurface, offsetX: number, offsetY: number): void {
    // Delegate through the abstract interface — never check instanceof
    source.copy(this, offsetX, offsetY);
  }

  copy(dst: RenderSurface, offsetX: number, offsetY: number): void {
    if (dst instanceof CanvasSurface) {
      // Same implementation — direct blit for performance
      dst.canvas.blit(this.canvas, offsetX, offsetY);
    } else {
      // Cross-implementation: serialize source, write to dst
      const text = this.serialize();
      const lines = text.split('\n');
      for (let y = 0; y < lines.length; y++) {
        const line = lines[y];
        if (line) dst.write(offsetX, offsetY + y, line);
      }
    }
  }

  serialize(): string {
    return this.canvas.renderFrame();
  }
}
