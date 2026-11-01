# TUI I/O Injection — Design Spec

**Date:** 2026-07-25
**Status:** Draft

## Problem

`TuiApp` (1,014 lines) mixes 7 concerns: terminal I/O, key dispatch, session dispatch, approval management, clipboard, rendering, and state transition. `paintFullFrame()` renders the entire display in one method. Tests cast to `any` and poke internal state.

## Design

Inject `IInput`/`IOutput` interfaces. Extract `KeyDispatcher` and `LayoutEngine`.

### I/O interfaces

```ts
export interface IInput {
  onData(cb: (buf: Buffer) => void): () => void;
}

export interface IOutput {
  write(text: string): void;
}

export class StdioInput implements IInput {
  constructor(private stdin: typeof process.stdin) {}
  onData(cb: (buf: Buffer) => void): () => void {
    this.stdin.on('data', cb);
    return () => this.stdin.off('data', cb);
  }
}

export class StdioOutput implements IOutput {
  write(text: string) { process.stdout.write(text); }
}
```

### KeyDispatcher

```ts
export class KeyDispatcher {
  private handlers: Map<string, () => boolean> = new Map();
  
  on(key: string, handler: () => boolean): void;
  dispatch(key: string): boolean;
}
```

### LayoutEngine

Extract the rendering math from `paintFullFrame()`:

```ts
export class LayoutEngine {
  computeLayout(dims: TerminalDimensions): Layout { ... }
  renderHeader(layout: Layout, state: TuiAppState): string[] { ... }
  renderFooter(layout: Layout, state: TuiAppState): string[] { ... }
}
```

### Testing

With I/O injected, tests no longer need `as any` casts:

```ts
const input = new MockInput();
const output = new MockOutput();
const app = new TuiApp({ input, output, ... });
input.emit(Buffer.from('hello'));
expect(output.writes).toContain('hello');
```
