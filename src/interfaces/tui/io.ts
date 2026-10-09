/**
 * Terminal I/O abstractions for TuiApp.
 *
 * IInput/IOutput let us inject mock implementations in tests and swap the
 * underlying streams without touching the 1,000-line TuiApp class.
 */

/**
 * Byte-level input stream.  The callback receives raw bytes from the
 * terminal (or a test harness).  Returns an unsubscribe function that
 * removes the listener when called — callers MUST invoke it during
 * cleanup to avoid leaking event listeners across test runs or TUI
 * restarts.
 */
export interface IInput {
  onData(cb: (buf: Buffer) => void): () => void;
}

/**
 * String-level output sink.  Callers write a fully-formed escape-sequence
 * or text chunk; the implementation routes it to the real terminal or a
 * test buffer.
 */
export interface IOutput {
  write(text: string): void;
}

// ---------------------------------------------------------------------------
// Real implementations
// ---------------------------------------------------------------------------

/**
 * Reads raw bytes from `process.stdin` (or any `Readable`-compatible
 * stream).  The constructor parameter allows injection in environments
 * where `process.stdin` is not available (e.g. internal lifecycle hooks).
 */
export class StdioInput implements IInput {
  constructor(
    private readonly stdin: { on(event: 'data', listener: (chunk: Buffer) => void): void; off(event: 'data', listener: (chunk: Buffer) => void): void },
  ) {}

  onData(cb: (buf: Buffer) => void): () => void {
    this.stdin.on('data', cb);
    return () => this.stdin.off('data', cb);
  }
}

/**
 * Writes text to `process.stdout`.  Simple pass-through so TuiApp never
 * needs to reference `process.stdout` directly.
 */
export class StdioOutput implements IOutput {
  write(text: string): void {
    process.stdout.write(text);
  }
}

// ---------------------------------------------------------------------------
// Test implementations — NOT exported from the public barrel
// ---------------------------------------------------------------------------

/**
 * Accumulates emitted bytes in a callback set so tests can drive
 * `TuiApp.handleRaw` indirectly through the same code path the real
 * terminal uses.
 */
export class MockInput implements IInput {
  private readonly cbs = new Set<(buf: Buffer) => void>();

  onData(cb: (buf: Buffer) => void): () => void {
    this.cbs.add(cb);
    return () => { this.cbs.delete(cb); };
  }

  /** Simulate a terminal byte sequence — calls every registered listener. */
  emit(buf: Buffer): void {
    for (const cb of this.cbs) cb(buf);
  }
}

/**
 * Captures every `write()` call into an array so tests can assert on the
 * rendered output without a real terminal.
 *
 * ```ts
 * const output = new MockOutput();
 * const app = new TuiApp({ input: new MockInput(), output, builder, daemonMetrics });
 * input.emit(Buffer.from('hello'));
 * expect(output.writes.some(w => w.includes('hello'))).toBe(true);
 * ```
 */
export class MockOutput implements IOutput {
  readonly writes: string[] = [];

  write(text: string): void {
    this.writes.push(text);
  }
}
