import { describe, it, expect, vi } from 'vitest';
import { StdioInput, StdioOutput, MockInput, MockOutput } from '../../src/tui/io.js';

// ---------------------------------------------------------------------------
// StdioInput / StdioOutput — smoke tests
// ---------------------------------------------------------------------------

describe('StdioInput', () => {
  it('forwards onData to stdin.on and returns an unsubscribe that calls stdin.off', () => {
    const on = vi.fn();
    const off = vi.fn();
    const stdin = { on, off };
    const input = new StdioInput(stdin);

    const cb = vi.fn();
    const unsubscribe = input.onData(cb);
    expect(on).toHaveBeenCalledWith('data', cb);

    unsubscribe();
    expect(off).toHaveBeenCalledWith('data', cb);
  });
});

describe('StdioOutput', () => {
  it('delegates write to process.stdout.write', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const output = new StdioOutput();
      output.write('hello');
      expect(spy).toHaveBeenCalledWith('hello');
    } finally {
      spy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// MockInput / MockOutput — deterministic test harness
// ---------------------------------------------------------------------------

describe('MockInput', () => {
  it('calls registered callbacks when emit() is invoked', () => {
    const input = new MockInput();
    const cb1 = vi.fn();
    const cb2 = vi.fn();

    input.onData(cb1);
    input.onData(cb2);
    input.emit(Buffer.from('hello'));

    expect(cb1).toHaveBeenCalledWith(Buffer.from('hello'));
    expect(cb2).toHaveBeenCalledWith(Buffer.from('hello'));
  });

  it('unsubscribe removes the callback', () => {
    const input = new MockInput();
    const cb = vi.fn();

    const unsub = input.onData(cb);
    unsub();
    input.emit(Buffer.from('hello'));

    expect(cb).not.toHaveBeenCalled();
  });

  it('multiple emits deliver to all active subscribers', () => {
    const input = new MockInput();
    const cb = vi.fn();
    input.onData(cb);
    input.emit(Buffer.from('a'));
    input.emit(Buffer.from('b'));
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenNthCalledWith(1, Buffer.from('a'));
    expect(cb).toHaveBeenNthCalledWith(2, Buffer.from('b'));
  });

  it('supports multiple concurrent subscribers', () => {
    const input = new MockInput();
    const results: string[] = [];
    input.onData((buf) => results.push('a:' + buf.toString()));
    input.onData((buf) => results.push('b:' + buf.toString()));
    input.emit(Buffer.from('x'));
    expect(results).toEqual(['a:x', 'b:x']);
  });
});

describe('MockOutput', () => {
  it('accumulates writes in the writes array', () => {
    const output = new MockOutput();
    output.write('a');
    output.write('b');
    expect(output.writes).toEqual(['a', 'b']);
  });
});
