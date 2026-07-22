export interface RenderSurface {
  readonly width: number;
  readonly height: number;

  write(x: number, y: number, text: string): void;
  drawBox(x: number, y: number, w: number, h: number, title?: string, colorCode?: string): void;
  drawBar(x: number, y: number, barWidth: number, fraction: number, color?: string): void;
  clear(): void;

  /** Copy content from another surface onto this one at offset.
   *  Implementations should delegate to source.copy(this, ox, oy) to
   *  preserve abstraction — never check instanceof. */
  blit(source: RenderSurface, offsetX: number, offsetY: number): void;

  /** Copy this surface's cells into target at (ox, oy). Called by
   *  target.blit(this, ...). Implementations fill dst cells. */
  copy(dst: RenderSurface, offsetX: number, offsetY: number): void;

  /** Serialize to a string for terminal output. TerminalControl.write()
   *  owns writing this to stdout — surface never writes directly. */
  serialize(): string;
}

export interface RenderSurfaceFactory {
  create(width: number, height: number): RenderSurface;
}
