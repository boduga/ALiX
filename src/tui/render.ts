// src/tui/render.ts — Scroll-region split-screen renderer.
//
// ANSI scroll region (ESC[top;bottomr) locks lines below <bottom> out of the
// scrollable area. Newlines within the region scroll content, but lines below
// the region are FIXED. The status bar lives in the fixed zone.
// Cursor save/restore prevents desync from external console.log output.
//
// Layout (24-line terminal):
//   0..19  — output area (scroll region, \n scrolls here)
//   20     — divider ────
//   21     — combined status  ○ EXECUTING | TOKENS: ████░░░░ 42% | Files: 3
//   22     — spinner        ⠋ Searching...
//   23     — reserved


const STATUS = 4;
const LINE = (n: number) => `\x1b[${n + 1};1H`;

export type Region = 'header' | 'body' | 'tabs' | 'status' | 'all';

export interface FrameBuffer {
  rows: string[];
  width: number;
  height: number;
}


// ── New region / framebuffer abstractions ──────────────────────────

export class TuiRenderer {
  private repaintAreas = new Set<Region>();
  private frame: FrameBuffer = { rows: [], width: 0, height: 0 };
  private _aliveResolve!: () => void;
  private readonly _alivePromise = new Promise<void>((resolve) => {
    this._aliveResolve = resolve;
  });

  constructor() {}

  /** Test seam + diff helper. */
  framesEqual(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  scheduleRepaint(region: Region): void {
    this.repaintAreas.add(region);
  }

  pump(): void {
    this.repaintAreas.clear();
  }

  /** For tests: peek at the queue. */
  get pendingRegions(): readonly Region[] {
    return [...this.repaintAreas];
  }

  /** For tests: replace the frame buffer reference. */
  setFrame(frame: FrameBuffer): void {
    this.frame = frame;
  }

  getFrame(): FrameBuffer {
    return this.frame;
  }


  /**
   * Block the event loop forever (or until `cleanup()` is called) so the
   * TUI stays alive.  The actual tick timer lives in TuiApp.refresh();
   * this method only keeps the process open.
   */
  async runEventLoop(): Promise<void> {
    return this._alivePromise;
  }

  async cleanup(): Promise<void> {
    this._aliveResolve();
  }
}
