// src/tui/render.ts — Minimal TUI wrapper.
//
// Just writes normal output. No status lines, no ANSI codes,
// no cursor math. The TUI command is a thin wrapper around
// runTask with streaming output going directly to stdout.

export class TuiRenderer {
  private running = false;

  constructor() {}

  start(): void { this.running = true; }
  stop(): void { this.running = false; }
  drawLayout(): void {}
  appendOutput(text: string, streaming = false): void {
    if (!this.running) return;
    process.stdout.write(text + (streaming ? "" : "\n"));
  }
}
